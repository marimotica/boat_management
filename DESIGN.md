# DESIGN.md

## Overview

`boat_management` is a Home Assistant custom integration for managing the operational state of a vessel.

It is broader than a maintenance logbook. Maintenance is one projection of a larger vessel model containing Equipment, Inventory, curated tasks, active work, and verified history.

The integration is local-first and skipper-oriented. It should work while cruising, without assuming internet access, stable networking, or a single timezone.

---

## Scope

The integration owns these subdomains:

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

Home Assistant surfaces these subdomains through:

- Config flow and options flow
- Services
- `todo` entity
- Aggregate sensors
- Diagnostics
- Repairs
- Optional websocket API for future custom UI

---

## Core Concept

The central design decision is:

```text
Curated Boat Task Catalogue
        ↓
Operational Event
        ↓
Matching Catalogue Tasks
        ↓
Work Items
        ↓
Review / Verification
        ↓
Immutable Maintenance Logbook
```

Operational events do not create arbitrary tasks. They instantiate known catalogue tasks curated by the owner or skipper.

Equipment and Inventory are not fields owned by the maintenance logbook. They are first-class registries. Tasks and log entries reference them by stable ID.

---

## Domain Model

### Vessel

```python
Vessel
  id: str
  name: str
  vessel_type: str | None
  callsign: str | None
  mmsi: str | None
  home_port: str | None
  default_timezone: str
  current_timezone: str
  timezone_source: str
  timezone_updated_at_utc: datetime
  units: dict
```

Rules:

- `id` is stable.
- `name` is display-only.
- `current_timezone` is editable.
- `default_timezone` is fallback operational state.
- UTC is canonical for storage.
- Historical records preserve the timezone used at the time.

### System

```python
System
  id: str
  name: str
  category: str | None
  description: str | None
  parent_system_id: str | None
  active: bool
```

Examples:

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

### Equipment

```python
Equipment
  id: str
  name: str
  system_id: str | None
  category: str | None
  manufacturer: str | None
  model: str | None
  serial_number: str | None
  location: str | None
  installed_date: date | None
  commissioned_date: date | None
  retired_date: date | None
  documentation_refs: list[str]
  inventory_refs: list[str]
  meter_refs: list[str]
  active: bool
```

Equipment represents installed maintainable assets:

```text
Main Engine
Anchor Windlass
Watermaker
AIS Transceiver
Radar
House Battery Bank
Standing Rigging
Bilge Pump
```

### Inventory Item

```python
InventoryItem
  id: str
  name: str
  category: str | None
  manufacturer: str | None
  part_number: str | None
  storage_location: str | None
  quantity: Decimal
  unit: str
  minimum_stock: Decimal | None
  reorder_level: Decimal | None
  equipment_refs: list[str]
  supplier_refs: list[str]
  expiry_date: date | None
  active: bool
```

Inventory includes consumables, spares, tools, and kits:

```text
Oil filter
Diesel pre-filter
Impeller kit
Engine oil 15W40
Sensor battery
Rigging tape
Bilge pump float switch
```

### Task Catalogue Item

```python
TaskCatalogueItem
  id: str
  title: str
  description: str | None
  system_refs: list[str]
  equipment_refs: list[str]
  inventory_refs: list[str]
  required_skills: list[str]
  estimated_duration_minutes: int | None
  procedure: str | None
  safety_notes: str | None
  default_verifier: str | None
  trigger_rules: list[TriggerRule]
  active: bool
  owner_curated: bool
```

Examples:

```text
Check engine oil
Inspect rig tension
Winterize freshwater system
Inspect through-hulls
Replace sensor batteries
Test bilge pumps
Prepare storm lines
```

### Work Item

```python
WorkItem
  id: str
  catalogue_task_id: str
  status: str
  trigger_source: str
  trigger_key: str | None
  operational_context_id: str | None
  assigned_to: str | None
  started_at_utc: datetime | None
  finished_at_utc: datetime | None
  submitted_for_review_at_utc: datetime | None
  verified_by: str | None
  verified_at_utc: datetime | None
  timezone_at_creation: str
  timezone_at_completion: str | None
  completion_notes: str | None
  evidence_refs: list[str]
  inventory_used: list[InventoryUsage]
  meter_readings: dict
```

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

### Maintenance Log Entry

```python
MaintenanceLogEntry
  id: str
  catalogue_task_id: str
  work_item_id: str
  completed_by: str | None
  verified_by: str
  completed_at_utc: datetime
  completed_at_local: str
  timezone_at_completion: str
  verified_at_utc: datetime
  system_refs: list[str]
  equipment_refs: list[str]
  notes: str | None
  evidence_refs: list[str]
  consumables_used: list[InventoryUsage]
  meter_readings: dict
  trigger_source: str
  amendments: list[LogbookAmendment]
```

Log entries are append-only. Corrections are amendments.

### Audit Event

```python
AuditEvent
  id: str
  event_type: str
  actor: str | None
  object_type: str
  object_id: str
  timestamp_utc: datetime
  timestamp_local: str
  timezone_at_event: str
  before: dict | None
  after: dict | None
  reason: str | None
```

---

## Relationships

```text
Vessel
  └─ Systems
      └─ Equipment
          ├─ Inventory references
          ├─ Task catalogue references
          └─ Maintenance history

Inventory
  ├─ Equipment references
  ├─ Low-stock rules
  └─ Consumption records

Task Catalogue
  └─ Work Items
      └─ Maintenance Log Entries
```

References use stable object IDs, never names.

---

## Work Item Lifecycle

Canonical lifecycle:

```text
todo → in_progress → review → done
```

Additional transitions:

```text
todo → blocked
in_progress → blocked
blocked → todo
blocked → in_progress
review → in_progress
todo → deferred
in_progress → deferred
review → deferred
todo → cancelled
in_progress → cancelled
review → cancelled
```

Verification behavior:

1. Validate Work Item is in `review`.
2. Validate verifier role or configured verifier.
3. Validate referenced catalogue task exists.
4. Validate equipment references still resolve or are historically retained.
5. Validate inventory usage and stock rules.
6. Create Maintenance Log Entry.
7. Deduct inventory if configured.
8. Mark Work Item `done`.
9. Update catalogue last-completed summary.
10. Write audit events.

This should be implemented as a single domain-level operation.

---

## Trigger Design

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

Trigger rules live on catalogue tasks. A trigger engine receives an operational event and returns matching catalogue task IDs.

Deduplication key:

```text
catalogue_task_id + trigger_source + trigger_key + operational_context_id
```

Examples:

```text
spring_commissioning
winter_layup
before_offshore_passage
after_arrival
engine_hours_250
inventory_low_stock
sensor_battery_low
```

---

## Home Assistant Entities

### Todo

```text
todo.boat_management_work_items
```

Represents active Work Items.

Mapping:

```text
todo        → needs_action
in_progress → needs_action
review      → needs_action
blocked     → needs_action
deferred    → needs_action
cancelled   → completed or hidden
done        → completed
```

The backend Work Item remains authoritative.

### Sensors

Initial aggregate sensors:

```text
sensor.boat_management_open_work_items
sensor.boat_management_items_in_review
sensor.boat_management_blocked_items
sensor.boat_management_overdue_items
sensor.boat_management_inventory_low_stock
sensor.boat_management_expiring_inventory
sensor.boat_management_equipment_due_maintenance
sensor.boat_management_last_maintenance
```

Optional binary sensor:

```text
binary_sensor.boat_management_requires_attention
```

Avoid generating large numbers of per-object entities by default.

---

## Services

Service families:

```yaml
# Vessel
boat_management.update_vessel
boat_management.set_vessel_timezone

# Systems
boat_management.create_system
boat_management.update_system
boat_management.archive_system

# Equipment
boat_management.create_equipment
boat_management.update_equipment
boat_management.retire_equipment

# Inventory
boat_management.create_inventory_item
boat_management.update_inventory_item
boat_management.adjust_inventory_quantity
boat_management.consume_inventory
boat_management.move_inventory
boat_management.mark_inventory_expired

# Task catalogue
boat_management.create_catalogue_task
boat_management.update_catalogue_task
boat_management.archive_catalogue_task

# Work items
boat_management.create_work_item
boat_management.claim_work_item
boat_management.start_work_item
boat_management.submit_for_review
boat_management.verify_work_item
boat_management.block_work_item
boat_management.defer_work_item
boat_management.cancel_work_item
boat_management.reopen_work_item

# Triggers and data
boat_management.apply_trigger_rules
boat_management.import_data
boat_management.export_data
boat_management.export_logbook
```

Services are the primary stable write API for v1.

---

## Storage Design

Use Home Assistant storage with versioned schema.

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

Storage concerns:

- Write through a storage manager.
- Keep domain operations atomic where practical.
- Use async locks around writes.
- Validate after load.
- Validate before save.
- Keep migrations pure and tested.
- Export using a documented schema version.

---

## Timezone Design

The vessel timezone must be independent of Home Assistant's timezone.

Use cases:

- Boat moves from Europe to Caribbean.
- Maintenance completed in one timezone and verified later in another.
- Passage planning crosses timezone boundaries.
- Seasonal reminders are based on the vessel's local operational context.

Policy:

- Store UTC for canonical ordering.
- Store local timestamp and timezone for historical meaning.
- Use vessel `current_timezone` for new operational events.
- Do not rewrite historical local timestamps when timezone changes.

Example:

```python
completed_at_utc = "2026-06-04T10:30:00Z"
completed_at_local = "2026-06-04T12:30:00+02:00"
timezone_at_completion = "Europe/Paris"
```

---

## Diagnostics

Diagnostics should include:

```text
config_entry_id
vessel_id
vessel_name
current_timezone
default_timezone
storage_version
object_counts
work_item_counts_by_status
low_stock_count
expiring_inventory_count
reference_integrity_summary
last_storage_load
last_storage_save
last_migration
last_trigger_run
recent_audit_summary
```

Diagnostics should not expose private free-form notes unless explicitly safe.

---

## Repairs

Create repairs for persisted issues that the user can fix:

```text
invalid_vessel_timezone
missing_equipment_reference
missing_inventory_reference
missing_catalogue_task_reference
negative_inventory_quantity
invalid_trigger_rule
duplicate_stable_id
migration_failed
log_entry_missing_timezone
```

---

## Implementation Phases

### Phase 1: Skeleton and Storage

- HACS-ready custom component structure
- Manifest
- Config flow
- Options flow
- Storage manager
- Schema versioning
- Diagnostics stub
- Basic tests

### Phase 2: Vessel, Systems, Equipment

- Vessel model with editable timezone
- System registry
- Equipment registry
- Equipment CRUD services
- Reference validation

### Phase 3: Inventory

- Inventory registry
- Quantity adjustment
- Stock locations
- Low-stock detection
- Expiry detection
- Equipment-compatible parts

### Phase 4: Task Catalogue

- Catalogue model
- Catalogue CRUD services
- Equipment and inventory references
- Trigger rule schema
- Import/export seed catalogue

### Phase 5: Work Items and Todo

- Work Item model
- State transition engine
- Todo platform
- Claim/start/review/verify services
- Aggregate sensors

### Phase 6: Maintenance Logbook

- Immutable log entries
- Verification transaction
- Inventory deduction on verification
- Audit events
- Export logbook

### Phase 7: Trigger Engine

- Seasonal triggers
- Passage-plan triggers
- Engine-hour/meter triggers
- Inventory triggers
- Dry-run support
- Deduplication

### Phase 8: UI/API Improvements

- Websocket API for custom panels
- Search/filter support
- Bulk import/export UI helpers
- Repairs UX refinement

---

## Future Integration Points

Potential future integrations:

- Signal K for live meter readings, tank state, position, alerts, and engine hours
- GPS timezone detection
- Calendar for planned maintenance
- Document storage for manuals and evidence
- Notifications for urgent work or low stock

These must remain optional. The core integration must work offline and locally.
