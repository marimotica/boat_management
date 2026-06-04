# Boat Management

A production-grade Home Assistant custom integration for managing a vessel's
operational knowledge: equipment, inventory, a curated task catalogue, active
work items, and an immutable maintenance logbook.

It is local-first and skipper-oriented: it works while cruising, without
assuming internet access or a single timezone.

## Features

- One config entry per managed vessel with an **editable vessel timezone**
  (defaults to Home Assistant's onboard timezone, with manual/GPS override).
- First-class **Equipment** and **Inventory** registries with stable IDs.
- A curated **Task Catalogue** separate from active **Work Items**.
- A deterministic Work Item lifecycle
  (`todo → in_progress → review → done`, plus `blocked`/`deferred`/`cancelled`).
- Verification into an **immutable Maintenance Logbook** with amendments.
- Inventory consumption on verification.
- A `todo` entity projecting active work, aggregate sensors, and a
  `requires attention` binary sensor.
- A pure **trigger engine** that instantiates known catalogue tasks from
  operational events, with deduplication and dry-run support.
- Diagnostics, repairs for broken references, and versioned import/export.

## Installation

### HACS

1. Add this repository as a custom repository (category: Integration).
2. Install **Boat Management**.
3. Restart Home Assistant.
4. Add the integration from **Settings → Devices & Services**.

### Manual

Copy `custom_components/boat_management` into your Home Assistant
`config/custom_components/` directory and restart.

## Documentation

See [`DESIGN.md`](DESIGN.md) for the architecture and
[`AGENTS.md`](AGENTS.md) for the non-negotiable domain rules.

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
ruff check .
black --check .
pytest
```
