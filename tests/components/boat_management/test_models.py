"""Round-trip serialization tests for domain models."""

from __future__ import annotations

from decimal import Decimal

from custom_components.boat_management.data import BoatData
from custom_components.boat_management.models import (
    Equipment,
    InventoryItem,
    InventoryUsage,
    MaintenanceLogEntry,
    System,
    TaskCatalogueItem,
    TriggerRule,
    Vessel,
    WorkItem,
)
from custom_components.boat_management.timezone import parse_utc, utc_now


def test_inventory_decimal_roundtrip() -> None:
    item = InventoryItem(
        id="inv1",
        name="Engine oil",
        quantity=Decimal("5.5"),
        unit="L",
        reorder_level=Decimal("2"),
    )
    restored = InventoryItem.from_dict(item.to_dict())
    assert restored == item
    assert restored.quantity == Decimal("5.5")


def test_inventory_low_stock() -> None:
    item = InventoryItem(
        id="i", name="x", quantity=Decimal("1"), reorder_level=Decimal("2")
    )
    assert item.is_low_stock()
    item.quantity = Decimal("3")
    assert not item.is_low_stock()


def test_work_item_roundtrip() -> None:
    wi = WorkItem(
        id="w1",
        catalogue_task_id="t1",
        created_at_utc=utc_now(),
        inventory_used=[InventoryUsage("inv1", Decimal("2"))],
    )
    restored = WorkItem.from_dict(wi.to_dict())
    assert restored.id == wi.id
    assert restored.inventory_used[0].quantity == Decimal("2")


def test_catalogue_trigger_rules_roundtrip() -> None:
    task = TaskCatalogueItem(
        id="t1",
        title="Check oil",
        trigger_rules=[TriggerRule(source="engine_hours", threshold=250.0)],
    )
    restored = TaskCatalogueItem.from_dict(task.to_dict())
    assert restored.trigger_rules[0].threshold == 250.0


def test_log_entry_roundtrip() -> None:
    now = utc_now()
    entry = MaintenanceLogEntry(
        id="log1",
        catalogue_task_id="t1",
        work_item_id="w1",
        verified_by="crew1",
        completed_at_utc=now,
        completed_at_local=now.isoformat(),
        timezone_at_completion="Europe/Paris",
        verified_at_utc=now,
    )
    restored = MaintenanceLogEntry.from_dict(entry.to_dict())
    assert restored.completed_at_utc == parse_utc(entry.to_dict()["completed_at_utc"])
    assert restored.timezone_at_completion == "Europe/Paris"


def test_full_boatdata_roundtrip() -> None:
    data = BoatData(
        vessel=Vessel(
            id="v1",
            name="Argo",
            default_timezone="UTC",
            current_timezone="Europe/Paris",
        ),
        systems={"s1": System(id="s1", name="Propulsion")},
        equipment={"e1": Equipment(id="e1", name="Main Engine", system_id="s1")},
    )
    restored = BoatData.from_dict(data.to_dict())
    assert restored.vessel.name == "Argo"
    assert restored.systems["s1"].name == "Propulsion"
    assert restored.equipment["e1"].system_id == "s1"
