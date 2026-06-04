# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
