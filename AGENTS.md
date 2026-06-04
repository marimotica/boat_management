# AGENTS.md

## Mission

Build a production-grade Home Assistant custom integration named `boat_management` for managing a vessel's operational knowledge: equipment, inventory, curated task catalogue, active work items, and immutable maintenance logbook.

The integration must help a skipper maintain a real boat with minimal friction, clear auditability, and reliable offline/local-first behavior.

Primary goals:

- Maintain a curated, owner-controlled model of the vessel.
- Treat Equipment and Inventory as first-class registries.
- Keep the Boat Task Catalogue separate from active Work Items.
- Instantiate known catalogue tasks from operational events; do not invent arbitrary tasks.
- Expose active Work Items through Home Assistant `todo` entities.
- Record verified work as immutable Maintenance Log Entries.
- Support global cruising by treating vessel timezone as editable operational state.
- Make diagnostics, repairs, import/export, and migrations explicit and reliable.

Non-negotiables:

- Correctness, stability, and debuggability beat feature breadth.
- Never silently lose, rewrite, or delete vessel history.
- Never mutate immutable log entries; use amendments instead.
- Never use display names as identity.
- Stable IDs must survive renames, relocations, and vessel timezone changes.
- All timestamps stored internally as UTC.
- Every persisted event that matters operationally must also preserve the vessel timezone used at the time.
- Active `todo` items are execution surfaces, not the source of truth.
- All user-facing service actions must validate references before writing state.
- Every write must be auditable.

Sailors do not want to debug software while managing a boat. Reliability beats cleverness.

---

## Context: Intended Integration

Repository target:

```text
custom_components/boat_management/
```

The integration manages these subdomains:

```text
boat_management
├── vessel
├── systems
├── equipment
├── inventory
├── task_catalogue
├── work_items
├── maintenance_logbook
├── crew
├── documents
├── triggers
└── audit
```

Suggested module layout:

```text
custom_components/boat_management/
  __init__.py
  manifest.json
  config_flow.py
  const.py
  models.py
  storage.py
  services.yaml

  vessel.py
  systems.py
  equipment.py
  inventory.py
  task_catalogue.py
  work_items.py
  logbook.py
  triggers.py
  audit.py
  validators.py
  migrations.py

  todo.py
  sensor.py
  binary_sensor.py
  repairs.py
  diagnostics.py
  websocket_api.py

  translations/
```

Tests should live in:

```text
tests/components/boat_management/
```

---

## Architectural Principles

- Use Home Assistant config entries.
- One config entry represents one managed vessel.
- Use Home Assistant storage helpers for local persistent state.
- Use schema versioning and explicit migrations.
- Separate domain logic from Home Assistant platform code.
- Keep state transitions deterministic and testable.
- Prefer pure helper functions for validation, transition rules, trigger matching, imports, exports, and migrations.
- Do not let `todo.py`, `sensor.py`, or websocket handlers own business logic.
- Treat Home Assistant entities as projections of the integration model.
- Treat services and websocket commands as controlled write APIs.
- Keep all writes transactional at the integration-storage level where possible.
- Write audit events for all meaningful mutations.

---

## Core Domain Rules

### Vessel

The vessel is the root object.

Required principles:

- Vessel identity is stable.
- Vessel name is display-only.
- Vessel timezone is editable because boats move globally.
- `current_timezone` affects local operational scheduling and display.
- UTC remains the internal source of truth.
- Historical events preserve `timezone_at_event`.

Never derive unique IDs from vessel name, home port, or timezone.

### Systems

Systems group equipment into skipper-friendly domains:

```text
Propulsion
Electrical
Rigging
Navigation
Fresh Water
Waste Water
Fuel
Ground Tackle
Safety
Tender
```

Systems may be hierarchical, but avoid overengineering v1. A flat system registry with optional `parent_system_id` is sufficient.

### Equipment

Equipment represents installed, maintainable vessel assets.

Rules:

- Equipment is first-class state.
- Equipment may be retired but should not be deleted automatically.
- Maintenance history must remain resolvable after equipment is retired.
- Equipment IDs must remain stable across renames and relocations.
- Equipment can reference compatible inventory items.
- Equipment can reference documents, manuals, meters, and task catalogue items.

### Inventory

Inventory represents spare parts, consumables, tools, kits, and stock items.

Rules:

- Inventory is first-class state.
- Inventory quantities must be validated before consumption.
- Inventory consumption should normally happen when work is verified, not merely started.
- Low-stock conditions should create or suggest Work Items through known catalogue tasks.
- Expired or retired inventory should remain historically resolvable.
- Quantity corrections must produce audit events.

### Task Catalogue

The Boat Task Catalogue is the finite, owner-controlled source of reusable tasks.

Rules:

- Catalogue items are definitions, not active work.
- Operational events instantiate known catalogue tasks.
- Do not create arbitrary work items without a catalogue item unless explicitly supporting an emergency/manual exception flow.
- Catalogue items reference systems, equipment, inventory, required skills, safety notes, procedures, and trigger rules.
- Catalogue items can be archived but should not be hard-deleted if referenced by history.

### Work Items

Work Items are instantiated tasks.

Allowed states:

```text
todo
in_progress
review
done
blocked
deferred
cancelled
```

Canonical flow:

```text
todo → in_progress → review → done
```

Additional flows:

```text
todo → blocked → todo
in_progress → blocked → in_progress
review → in_progress
any active state → deferred
any active state → cancelled
```

Rules:

- Crew can claim available work.
- Assigned crew can submit work for review.
- Only a captain, skipper, or configured verifier can verify work.
- Moving `review → done` creates a Maintenance Log Entry.
- Reopening a done item must not delete the log entry. Create a corrective Work Item or amendment instead.

### Maintenance Logbook

The logbook is immutable verified maintenance history.

Rules:

- Create log entries only from verified work or explicit imported history.
- Store UTC timestamps plus local display timestamp and `timezone_at_event`.
- Preserve equipment, inventory, crew, notes, evidence, meter readings, and trigger source as they were at completion.
- Do not mutate log entries. Use amendments.
- Deleting log entries is out of scope for normal operation.

---

## Home Assistant Platform Rules

### Config Flow

Initial setup should collect:

- Vessel display name
- Optional stable vessel identifier
- Home port
- Default timezone
- Current timezone
- Unit preferences

Options flow should allow editing:

- Current vessel timezone
- Default timezone
- Unit preferences
- Trigger automation settings
- Low-stock behavior
- Diagnostics verbosity

Validation:

- Validate timezone names against IANA timezone database.
- Normalize empty strings to `None` where appropriate.
- Fail fast on invalid schema or conflicting identifiers.
- Do not require internet access.

### Entities

Entity surfaces are projections:

```text
todo.boat_management_work_items
sensor.boat_management_open_work_items
sensor.boat_management_items_in_review
sensor.boat_management_blocked_items
sensor.boat_management_overdue_items
sensor.boat_management_inventory_low_stock
sensor.boat_management_expiring_inventory
sensor.boat_management_equipment_due_maintenance
sensor.boat_management_last_maintenance
binary_sensor.boat_management_requires_attention
```

Entity rules:

- Use stable `unique_id` values based on config entry ID and internal object IDs.
- Do not encode vessel name, equipment name, or inventory name into `unique_id`.
- Do not create excessive per-object entities by default.
- Prefer aggregate sensors for v1.
- Per-equipment sensors may be disabled by default if implemented.
- Missing referenced records should make diagnostics/repairs noisy, not crash setup.

### Todo Platform

`todo.boat_management_work_items` exposes active work items.

Rules:

- The `todo` entity is not the canonical store.
- The backend Work Item model is canonical.
- HA todo completion must route through the same verification rules or be treated as a request to transition.
- Preserve richer states (`in_progress`, `review`, `blocked`, `deferred`) in backend attributes and services.
- Avoid flattening lifecycle semantics into Home Assistant's limited todo model without audit events.

### Services

Implement services for controlled writes.

Required service groups:

```yaml
boat_management.create_equipment
boat_management.update_equipment
boat_management.retire_equipment

boat_management.create_inventory_item
boat_management.update_inventory_item
boat_management.adjust_inventory_quantity
boat_management.consume_inventory
boat_management.move_inventory
boat_management.mark_inventory_expired

boat_management.create_catalogue_task
boat_management.update_catalogue_task
boat_management.archive_catalogue_task

boat_management.create_work_item
boat_management.claim_work_item
boat_management.start_work_item
boat_management.submit_for_review
boat_management.verify_work_item
boat_management.block_work_item
boat_management.defer_work_item
boat_management.cancel_work_item
boat_management.reopen_work_item

boat_management.set_vessel_timezone
boat_management.apply_trigger_rules
boat_management.import_data
boat_management.export_data
boat_management.export_logbook
```

Service rules:

- Validate all references before writing.
- Validate all state transitions.
- Reject ambiguous IDs.
- Return actionable errors.
- Write audit events for successful mutations.
- Use repairs for persistent invalid state.

---

## Timezone and Timestamp Policy

Boats move. Timezone is operational state.

Required vessel fields:

```python
Vessel
  id
  name
  home_port
  default_timezone
  current_timezone
  timezone_source
  timezone_updated_at_utc
```

Allowed timezone sources:

```text
manual
home_port
gps_position
imported
```

Rules:

- Store all canonical timestamps in UTC.
- Store `timezone_at_event` for all audit events, work transitions, and log entries.
- For human-facing due dates, store date intent separately from instant timestamps when needed.
- Do not reinterpret historical local times after vessel timezone changes.
- Default the vessel timezone to Home Assistant's configured timezone, since Home Assistant is expected to run onboard; resolve the active timezone as `vessel.current_timezone or hass.config.time_zone`.
- Allow manual or GPS-derived overrides, which become vessel truth once set; still preserve the local timezone context on every persisted event so history stays correct after the timezone changes.

Example event timestamp fields:

```python
completed_at_utc
completed_at_local
completed_timezone
```

---

## Storage and Migration Rules

Use one storage namespace with explicit versioning:

```json
{
  "version": 1,
  "vessels": {},
  "systems": {},
  "equipment": {},
  "inventory": {},
  "task_catalogue": {},
  "work_items": {},
  "maintenance_log": {},
  "crew": {},
  "documents": {},
  "audit_events": {}
}
```

Rules:

- Every stored object must have an `id`, timestamps, and schema version where useful.
- Migrations must be deterministic and covered by tests.
- Migrations must preserve unknown future-safe fields when possible.
- Failed migration should raise a repair issue and avoid partial writes.
- Use backup-before-migration semantics if practical.
- Import/export schema should be documented and versioned.

---

## Trigger Engine Rules

Trigger sources:

```text
manual
passage_plan
seasonal_transition
engine_hours
calendar
inventory
inspection_result
equipment_fault
meter_threshold
```

Rules:

- Triggers select from catalogue tasks.
- Triggers must deduplicate existing open work items.
- Deduplication key should include catalogue task ID, trigger source, trigger key, and operational context ID.
- Trigger matching should be pure and unit-tested.
- Do not silently create dozens of tasks without clear source context.
- Provide dry-run support before bulk creation where possible.

---

## Diagnostics and Repairs

Diagnostics must make failures obvious without SSH.

Diagnostics should expose redacted summaries of:

- Config entry ID
- Vessel identity and display name
- Current/default timezone
- Storage schema version
- Object counts by domain
- Open Work Item counts by status
- Low-stock inventory count
- Expiring inventory count
- Due-maintenance count
- Last successful storage load/save
- Last migration version
- Last trigger run
- Reference integrity problems
- Recent audit event summary

Repairs should be created for:

- Invalid timezone
- Broken equipment references
- Broken inventory references
- Work Items referencing archived/missing catalogue tasks
- Inventory quantities below zero
- Log entries missing historical timezone
- Migration failures
- Duplicate stable IDs
- Invalid trigger rules

Diagnostics must redact secrets and avoid dumping free-form private notes unless explicitly safe.

---

## Reliability and Lifecycle

Home Assistant lifecycle rules:

- Setup must be idempotent.
- Unload must remove listeners and timers cleanly.
- Reload must preserve entity registry and storage state.
- Storage load failure must be actionable.
- Storage save failure must be logged and surfaced.
- Periodic trigger evaluation must not overlap itself.
- Service calls must not race corrupt storage.

If external integrations are used later, such as Signal K or GPS timezone detection:

- External failure must not unload the integration.
- External data must be advisory unless explicitly configured as authoritative.
- Local state must remain usable offline.

---

## Testability Requirements

Keep these areas mostly pure and directly unit-testable:

```text
models.py
validators.py
transitions.py
triggers.py
migrations.py
import_export.py
timezone.py
audit.py
```

Mandatory unit tests:

- Vessel timezone validation and update behavior
- UTC/local timestamp preservation
- Equipment CRUD validation
- Inventory quantity adjustment and consumption
- Catalogue task validation
- Work Item state transition matrix
- Verification creates immutable log entry
- Reopening does not delete log entry
- Trigger matching and deduplication
- Import/export roundtrip
- Migration from every supported schema version
- Reference integrity checks

Mandatory HA harness tests:

- Config flow create/update/reload
- Options flow timezone changes
- Service calls mutate storage correctly
- `todo` entity reflects active Work Items
- Sensor counts update after service calls
- Diagnostics output redacts sensitive data
- Repairs are created for invalid persisted references

Snapshot tests should protect:

- Export schema
- Diagnostics shape
- Service schemas
- State transition behavior

---

## CI and Quality Gates

Minimum quality gates:

```text
ruff
black
pytest
pytest-homeassistant-custom-component
```

Recommended:

```text
mypy or pyright for pure modules
coverage reporting
pre-commit
GitHub Actions
HACS validation
hassfest validation where applicable
```

Rules:

- New domain logic requires tests.
- New services require service schema tests.
- New stored fields require migration consideration.
- New user-facing strings require translations.
- No broad exception swallowing.
- Logs must be actionable and rate-limited.

---

## Implementation Style

- Prefer dataclasses or typed models for domain objects.
- Keep Home Assistant imports out of pure domain modules where possible.
- Keep validation close to model boundaries.
- Use explicit enums/constants for statuses, trigger sources, units, and roles.
- Do not use stringly typed status checks scattered through platform code.
- Keep service handlers thin.
- Keep websocket API handlers thin.
- Keep storage serialization explicit.
- Avoid ad-hoc dictionaries in business logic once models exist.

Code comments:

- Comment constraints and reasons, not obvious mechanics.
- Add comments at lifecycle boundaries, migration code, transition enforcement, and timezone handling.
- Avoid noisy comments that restate function names.

---

## Non-Goals for v1

- No cloud backend.
- No multi-vessel fleet management in one config entry.
- No destructive logbook editing.
- No complex custom Lovelace/Kanban frontend before backend semantics are stable.
- No automatic task generation outside known catalogue tasks.
- No purchasing integration.
- No bidirectional control of boat systems.
- No assumption that Signal K is present.

---

## Definition of Done

A v1 feature is done when:

- It is installable through HACS or manual custom component installation.
- It works after Home Assistant restart.
- It survives integration reload.
- It has deterministic storage behavior.
- It has user-facing validation errors.
- It has diagnostics or repair coverage where appropriate.
- It has unit tests for core logic.
- It has HA harness tests for entity/service behavior where relevant.
- It preserves auditability.
- It does not compromise immutable maintenance history.

Final principle:

Correctness, stability, and debuggability outweigh completeness.
