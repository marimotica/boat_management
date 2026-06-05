"""Diagnostics for boat_management.

Diagnostics must make failures obvious without SSH (AGENTS.md). Output is a
redacted summary: counts, status breakdowns, reference-integrity problems, and
lifecycle markers. Free-form private notes are never dumped.
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, STORAGE_VERSION, WorkItemStatus
from .coordinator import BoatCoordinator
from .data import BoatData
from .equipment import equipment_due_for_maintenance
from .validators import (
    check_equipment_references,
    check_inventory_quantities,
    check_log_entry_timezones,
    check_work_item_references,
)


def _reference_problems(data: BoatData) -> list[dict[str, Any]]:
    problems = []
    problems += check_equipment_references(data.equipment, data.systems, data.inventory)
    problems += check_inventory_quantities(data.inventory)
    problems += check_work_item_references(data.work_items, data.task_catalogue)
    problems += check_log_entry_timezones(data.maintenance_log)
    return [p.to_dict() for p in problems]


def build_diagnostics(coordinator: BoatCoordinator) -> dict[str, Any]:
    """Build a redacted diagnostics payload from a coordinator."""
    data = coordinator.data
    vessel = data.vessel

    status_counts = {status.value: 0 for status in WorkItemStatus}
    for wi in data.work_items.values():
        status_counts[wi.status] = status_counts.get(wi.status, 0) + 1

    low_stock = sum(1 for i in data.inventory.values() if i.active and i.is_low_stock())
    expiring = sum(1 for i in data.inventory.values() if i.active and i.expired)
    due_maintenance = len(equipment_due_for_maintenance(data))

    return {
        "config_entry_id": coordinator.entry.entry_id,
        "vessel": {
            "id": vessel.id,
            "name": vessel.name,
            "current_timezone": vessel.current_timezone,
            "default_timezone": vessel.default_timezone,
            "timezone_source": vessel.timezone_source,
        },
        "storage_version": STORAGE_VERSION,
        "object_counts": {
            "systems": len(data.systems),
            "equipment": len(data.equipment),
            "inventory": len(data.inventory),
            "task_catalogue": len(data.task_catalogue),
            "work_items": len(data.work_items),
            "maintenance_log": len(data.maintenance_log),
            "crew": len(data.crew),
            "documents": len(data.documents),
            "audit_events": len(data.audit_events),
        },
        "work_item_counts_by_status": status_counts,
        "low_stock_count": low_stock,
        "expiring_inventory_count": expiring,
        "due_maintenance_count": due_maintenance,
        "reference_integrity": {
            "problem_count": len(_reference_problems(data)),
            "problems": _reference_problems(data),
        },
        "last_storage_load": coordinator.store.last_loaded_at,
        "last_storage_save": coordinator.store.last_saved_at,
        "last_migration_from": coordinator.store.last_migration_from,
        "last_trigger_run": coordinator.last_trigger_run,
        "recent_audit_summary": [
            {
                "event_type": ev.event_type,
                "object_type": ev.object_type,
                "timestamp_utc": ev.timestamp_utc.isoformat(),
            }
            for ev in sorted(
                data.audit_events.values(),
                key=lambda e: e.timestamp_utc,
                reverse=True,
            )[:10]
        ],
    }


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    coordinator: BoatCoordinator = hass.data[DOMAIN][entry.entry_id]
    return build_diagnostics(coordinator)
