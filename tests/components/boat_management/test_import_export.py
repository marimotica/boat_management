"""Unit tests for import/export round-trip and conflict handling."""

from __future__ import annotations

from custom_components.boat_management.equipment import create_equipment
from custom_components.boat_management.import_export import (
    IMPORT_MODE_MERGE,
    apply_import,
    export_payload,
)
from custom_components.boat_management.systems import create_system

from .helpers import make_data


def test_export_import_roundtrip() -> None:
    data = make_data()
    sys = create_system(data, name="Propulsion")
    create_equipment(data, name="Main Engine", system_id=sys.id)

    payload = export_payload(data.to_dict())
    assert payload["export_schema_version"] == 1

    # Import into an empty vessel.
    target = make_data()
    result, report = apply_import(target.to_dict(), payload, mode=IMPORT_MODE_MERGE)
    assert report.added_count >= 2
    assert len(result["equipment"]) == 1
    assert len(result["systems"]) == 1


def test_dry_run_does_not_mutate() -> None:
    data = make_data()
    create_system(data, name="Electrical")
    payload = export_payload(data.to_dict())

    target = make_data()
    before = target.to_dict()
    result, report = apply_import(target.to_dict(), payload, dry_run=True)
    assert report.dry_run is True
    assert report.added_count >= 1
    # Returned storage unchanged on dry-run.
    assert result["systems"] == before["systems"]


def test_immutable_log_not_overwritten() -> None:
    payload = {
        "export_schema_version": 1,
        "collections": {
            "maintenance_log": {
                "log1": {"id": "log1", "notes": "incoming"},
            }
        },
    }
    current = make_data().to_dict()
    current["maintenance_log"] = {"log1": {"id": "log1", "notes": "original"}}

    result, report = apply_import(current, payload, mode=IMPORT_MODE_MERGE)
    assert result["maintenance_log"]["log1"]["notes"] == "original"
    assert report.conflicts
