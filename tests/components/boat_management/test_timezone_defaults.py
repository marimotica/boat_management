"""Tests for the Home-Assistant-timezone-driven policy.

The vessel timezone is always taken from ``hass.config.time_zone``; there is
no separate vessel-level override. When HA's timezone changes the coordinator
syncs automatically.
"""

from __future__ import annotations

from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import EVENT_CORE_CONFIG_UPDATE
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.boat_management.const import (
    CONF_VESSEL_NAME,
    DOMAIN,
)


async def test_new_vessel_defaults_to_ha_timezone(hass: HomeAssistant) -> None:
    """A vessel created without explicit timezone data inherits HA's timezone."""
    hass.config.set_time_zone("Pacific/Auckland")

    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Onboard",
        data={CONF_VESSEL_NAME: "Onboard"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    coordinator = hass.data[DOMAIN][entry.entry_id]
    assert coordinator.data.vessel.current_timezone == "Pacific/Auckland"
    assert coordinator.active_timezone == "Pacific/Auckland"


async def test_active_timezone_falls_back_when_unset(
    hass: HomeAssistant, setup_vessel
) -> None:
    """active_timezone falls back to HA's live timezone when current_timezone is empty."""
    hass.config.set_time_zone("Pacific/Auckland")
    _entry, coordinator = setup_vessel

    # Simulate a stale/empty stored value (defensive guard only).
    coordinator.data.vessel.current_timezone = ""
    assert coordinator.active_timezone == "Pacific/Auckland"


async def test_ha_timezone_change_syncs_vessel(
    hass: HomeAssistant, setup_vessel
) -> None:
    """When HA timezone changes the coordinator syncs vessel.current_timezone."""
    _entry, coordinator = setup_vessel
    assert coordinator.data.vessel.current_timezone == "Europe/Paris"

    # Simulate HA timezone change.
    hass.config.set_time_zone("America/New_York")
    hass.bus.async_fire(EVENT_CORE_CONFIG_UPDATE, {})
    await hass.async_block_till_done()

    assert coordinator.data.vessel.current_timezone == "America/New_York"
    assert coordinator.active_timezone == "America/New_York"


async def test_ha_timezone_change_writes_audit_event(
    hass: HomeAssistant, setup_vessel
) -> None:
    """A timezone change originating from HA is recorded in the audit log."""
    _entry, coordinator = setup_vessel
    initial_audit_count = len(coordinator.data.audit_events)

    hass.config.set_time_zone("Asia/Tokyo")
    hass.bus.async_fire(EVENT_CORE_CONFIG_UPDATE, {})
    await hass.async_block_till_done()

    assert len(coordinator.data.audit_events) == initial_audit_count + 1
    last_event = max(
        coordinator.data.audit_events.values(),
        key=lambda e: e.timestamp_utc,
    )
    assert last_event.event_type == "timezone_change"
    assert "Asia/Tokyo" in (last_event.after or {}).get("current_timezone", "")
