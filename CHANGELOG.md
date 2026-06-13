# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] - 2026-06-13

### Added

- Two-mode panel navigation: **Work** (board, operational suggestions, logbook)
  and **Locker** (inventory, equipment, systems, task catalogue) registries.
- Maintenance logbook view surfacing immutable verified history in the panel.
- Nested inline create flow: build an inventory item, its linked equipment, and
  that equipment's system without leaving the sheet, preserving in-flight drafts
  and auto-selecting each server-assigned record.
- Photo & document capture for equipment and inventory: camera/file upload via
  base64 websocket commands, blobs stored under the config-entry directory, an
  authenticated media view, and edit-mode attach/detach with audit events.
- `documents` collection and per-record `media_refs`, with reference-integrity
  repairs for missing document targets.

### Fixed

- Removed a duplicate `after_dependencies` key in the manifest that silently
  cleared the intended `frontend`/`panel_custom`/`websocket_api` setup ordering.

## [Unreleased]

### Added

- Initial v1 implementation of the `boat_management` integration:
  - Vessel model with editable timezone and UTC-canonical timestamps.
  - Systems, Equipment, and Inventory registries with stable IDs.
  - Curated Task Catalogue and Work Item lifecycle with a pure transition matrix.
  - `todo` projection, aggregate sensors, and a `requires attention` binary sensor.
  - Immutable Maintenance Logbook verification transaction with amendments.
  - Inventory consumption on verification.
  - Pure trigger engine with deduplication and dry-run support.
  - Controlled service write API with audit events.
  - Diagnostics, repairs for broken references, and versioned import/export.
  - Config and options flows with IANA timezone validation.
