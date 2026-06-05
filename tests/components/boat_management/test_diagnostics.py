"""Tests for diagnostics output and redaction."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from custom_components.boat_management.const import (
    DOMAIN,
    SERVICE_CREATE_EQUIPMENT,
    SERVICE_CREATE_SYSTEM,
)
from custom_components.boat_management.diagnostics import (
    async_get_config_entry_diagnostics,
)


async def test_diagnostics_shape(hass: HomeAssistant, setup_vessel) -> None:
    entry, _coordinator = setup_vessel
    diag = await async_get_config_entry_diagnostics(hass, entry)

    assert diag["config_entry_id"] == entry.entry_id
    assert diag["storage_version"] >= 1
    assert set(diag["object_counts"]) == {
        "systems",
        "equipment",
        "inventory",
        "task_catalogue",
        "work_items",
        "maintenance_log",
        "crew",
        "documents",
        "audit_events",
    }
    assert "work_item_counts_by_status" in diag
    assert "reference_integrity" in diag
    assert "due_maintenance_count" in diag


async def test_diagnostics_counts_due_maintenance(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, _coordinator = setup_vessel
    # Equipment with a maintenance schedule but no resolvable baseline surfaces
    # as due, so the diagnostics count is noisy rather than silently zero.
    await hass.services.async_call(
        DOMAIN,
        SERVICE_CREATE_EQUIPMENT,
        {"name": "Engine", "maintenance_interval_days": 180},
        blocking=True,
    )
    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert diag["due_maintenance_count"] == 1


async def test_diagnostics_does_not_leak_notes(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, _coordinator = setup_vessel
    await hass.services.async_call(
        DOMAIN,
        SERVICE_CREATE_SYSTEM,
        {"name": "Electrical", "description": "SECRET wiring notes"},
        blocking=True,
    )
    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert "SECRET" not in str(diag)
