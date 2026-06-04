"""Tests for integration setup, unload, and reload lifecycle."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.boat_management.const import (
    CONF_CURRENT_TIMEZONE,
    CONF_DEFAULT_TIMEZONE,
    CONF_VESSEL_NAME,
    DOMAIN,
)


def _entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Test Vessel",
        data={
            CONF_VESSEL_NAME: "Test Vessel",
            CONF_DEFAULT_TIMEZONE: "Europe/Paris",
            CONF_CURRENT_TIMEZONE: "Europe/Paris",
        },
    )


async def test_setup_and_unload(hass: HomeAssistant) -> None:
    entry = _entry()
    entry.add_to_hass(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    assert entry.entry_id in hass.data[DOMAIN]

    # Services are registered.
    assert hass.services.has_service(DOMAIN, "create_equipment")

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED


async def test_reload_preserves_state(hass: HomeAssistant) -> None:
    entry = _entry()
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # Create an equipment item, then reload and confirm it persists.
    await hass.services.async_call(
        DOMAIN,
        "create_equipment",
        {"name": "Main Engine"},
        blocking=True,
    )
    coordinator = hass.data[DOMAIN][entry.entry_id]
    assert len(coordinator.data.equipment) == 1

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    coordinator = hass.data[DOMAIN][entry.entry_id]
    assert len(coordinator.data.equipment) == 1
