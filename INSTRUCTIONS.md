# INSTRUCTIONS.md

## Development Instructions

This repository implements a Home Assistant custom integration called `boat_management`.

The integration is a local-first vessel-management system. It manages Equipment, Inventory, Task Catalogue, Work Items, Maintenance Logbook, and operational audit history.

Read these files before making changes:

```text
AGENTS.md
DESIGN.md
INSTRUCTIONS.md
```

Treat `AGENTS.md` as authoritative for agent behavior and non-negotiables. Treat `DESIGN.md` as the current architecture.

---

## Repository Layout

Expected structure:

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

tests/components/boat_management/
```

Keep business logic out of HA platform files when possible.

---

## Setup for Local Development

Recommended workflow:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
```

Recommended checks:

```bash
ruff check .
black --check .
pytest
```

If the repository uses `pre-commit`:

```bash
pre-commit install
pre-commit run --all-files
```

For Home Assistant custom component testing, use `pytest-homeassistant-custom-component` and keep HA harness tests under `tests/components/boat_management/`.

---

## Implementation Order

Follow this order unless there is a specific reason not to:

1. Integration skeleton
2. Storage manager and schema versioning
3. Vessel model with editable timezone
4. Systems registry
5. Equipment registry
6. Inventory registry
7. Task Catalogue
8. Work Item lifecycle
9. HA `todo` projection
10. Maintenance Logbook verification flow
11. Aggregate sensors
12. Trigger engine
13. Diagnostics and repairs
14. Import/export
15. Optional websocket API for custom UI

Do not build a custom frontend before the backend model and services are stable.

---

## Coding Rules

### General

- Use async Home Assistant APIs correctly.
- Do not block the event loop.
- Do not perform network calls in the core path unless explicitly part of a future optional integration.
- Use typed models for domain objects.
- Use constants/enums for statuses, trigger sources, roles, and object types.
- Avoid scattered string literals.
- Validate at API boundaries.
- Log actionable messages.
- Rate-limit repetitive warnings.

### Domain Logic

Put pure logic in modules that do not depend on Home Assistant:

```text
models.py
validators.py
transitions.py
triggers.py
migrations.py
timezone.py
import_export.py
```

Home Assistant modules should call domain functions; they should not duplicate rules.

### Storage

- Use Home Assistant storage helpers.
- Include a top-level schema version.
- Use async locks around write operations.
- Validate loaded data.
- Validate before saving.
- Make migrations deterministic.
- Preserve unknown fields where feasible.
- Never silently discard history.

### IDs and Names

- IDs are identity.
- Names are display.
- Do not derive `unique_id` from names.
- Do not derive object IDs from names unless the user explicitly imports deterministic IDs.
- Renaming a vessel, system, equipment item, inventory item, or task must not break history.

### Time

- Store canonical timestamps in UTC.
- Preserve local timestamp and `timezone_at_event` for historical records.
- Vessel timezone is editable.
- Vessel timezone defaults to Home Assistant's timezone (it runs onboard); a manual or GPS override becomes vessel truth once set. Resolve the active timezone as `vessel.current_timezone or hass.config.time_zone`.
- Do not reinterpret historical records after timezone changes.
- Validate timezone strings against IANA names.

### Maintenance History

- Verified Maintenance Log Entries are immutable.
- Corrections are amendments.
- Reopened work does not delete history.
- Inventory consumption linked to verified work must remain traceable.

---

## State Transition Rules

Allowed Work Item states:

```text
todo
in_progress
review
done
blocked
deferred
cancelled
```

Canonical transitions:

```text
todo → in_progress
in_progress → review
review → done
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

Disallowed:

```text
done → todo
cancelled → done
missing catalogue task → done
negative inventory consumption
verification without verifier
```

If corrective work is needed after `done`, create a new Work Item or a logbook amendment.

---

## Service Implementation Rules

Every service handler must:

1. Parse and validate input.
2. Resolve references.
3. Check permissions/roles where applicable.
4. Call domain logic.
5. Persist state.
6. Write audit event.
7. Notify affected entities.
8. Raise actionable Home Assistant errors on failure.

Avoid partial writes. If a multi-step operation fails, persisted state must remain consistent.

---

## Diagnostics and Repairs

Add diagnostics for new subdomains.

Add repairs when a problem is persistent and user-actionable.

Examples:

```text
invalid timezone
missing equipment reference
missing inventory reference
missing catalogue task
negative quantity
invalid trigger rule
duplicate stable ID
migration failed
```

Diagnostics must redact sensitive content and avoid dumping private free-form notes.

---

## Testing Instructions

### Unit Tests

Add or update unit tests for:

- Model serialization/deserialization
- Timezone validation
- UTC/local timestamp preservation
- Equipment validation
- Inventory quantity rules
- Catalogue task validation
- Work Item transition matrix
- Verification transaction
- Logbook immutability
- Trigger matching
- Trigger deduplication
- Import/export roundtrip
- Migrations

### Home Assistant Tests

Add or update HA harness tests for:

- Config flow
- Options flow
- Reload/unload
- Service schemas
- Service mutations
- Entity state updates
- Todo item projection
- Diagnostics output
- Repairs creation

### Snapshot Tests

Use snapshot tests for:

- Export schema
- Diagnostics shape
- Service schema shape
- Transition matrix

---

## Pull Request Checklist

Before opening or merging a PR:

```text
[ ] ruff passes
[ ] black passes
[ ] pytest passes
[ ] New domain logic has unit tests
[ ] New HA behavior has HA harness tests where practical
[ ] New stored fields have migration consideration
[ ] New services are documented in services.yaml
[ ] New user-facing strings are translated
[ ] Diagnostics updated if new operational state was added
[ ] Repairs added for persistent user-actionable failure states
[ ] No immutable history is mutated
[ ] No IDs are derived from display names
[ ] Timezone behavior is correct for moving vessels
```

---

## HACS and Home Assistant Compatibility

The integration should be installable as a HACS custom repository.

Required repository files:

```text
hacs.json
README.md
CHANGELOG.md
LICENSE
custom_components/boat_management/manifest.json
```

Recommended validations:

```bash
hacs action
hassfest
pytest
ruff check .
black --check .
```

Keep the minimum supported Home Assistant version explicit in `manifest.json` and CI.

---

## Logging Policy

Use logs to help a skipper fix problems.

Good logs:

```text
Cannot verify work item abc123: referenced inventory item oil_filter_1 is missing
Invalid vessel timezone "UTC+2"; expected IANA timezone such as Europe/Paris
Skipped trigger winter_layup for task freshwater_winterize because matching work item already exists
```

Bad logs:

```text
Error
Failed
Exception happened
```

Use levels consistently:

```text
DEBUG: detailed internal flow, rate-limited
INFO: setup, reload, successful migrations, major lifecycle actions
WARNING: recoverable persistent issue
ERROR: failed write, failed migration, corrupted storage
```

---

## Import and Export

Export must include schema version and enough data to reconstruct history.

Rules:

- Export should preserve IDs.
- Import should validate before mutating live state.
- Support dry-run import.
- Report conflicts clearly.
- Do not overwrite immutable log entries without explicit migration/import mode.
- Prefer additive imports for catalogue seeds.

---

## Agent Best Practices

When implementing with coding agents:

- Start by reading `AGENTS.md` and `DESIGN.md`.
- Make small, coherent changes.
- Prefer one domain per PR.
- Add tests with the feature.
- Do not skip migrations.
- Do not hide failing tests by weakening assertions.
- Do not add broad `except Exception` blocks without re-raising or surfacing diagnostics.
- Do not implement speculative frontend behavior before backend semantics are stable.
- Keep user-facing behavior deterministic.
- Favor explicit schemas over implicit dictionaries.
- Ask for clarification only when the model would otherwise become ambiguous or destructive.

---

## v1 Completion Target

The first useful release should support:

- UI setup for one vessel
- Editable vessel timezone
- Equipment registry
- Inventory registry
- Curated task catalogue
- Manual Work Item creation from catalogue tasks
- Work Item lifecycle services
- `todo` projection for active work
- Verification into immutable Maintenance Log Entries
- Inventory consumption on verification
- Aggregate sensors
- Diagnostics
- Repairs for broken references
- Export/import of integration data

Everything else is secondary.
