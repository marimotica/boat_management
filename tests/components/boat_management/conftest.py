"""Fixtures for boat_management HA harness tests."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.boat_management.const import (
    CONF_CURRENT_TIMEZONE,
    CONF_DEFAULT_TIMEZONE,
    CONF_VESSEL_NAME,
    DOMAIN,
)


@pytest.fixture
async def setup_vessel(hass: HomeAssistant):
    """Set up a configured vessel and return (entry, coordinator)."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Test Vessel",
        data={
            CONF_VESSEL_NAME: "Test Vessel",
            CONF_DEFAULT_TIMEZONE: "Europe/Paris",
            CONF_CURRENT_TIMEZONE: "Europe/Paris",
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = hass.data[DOMAIN][entry.entry_id]
    return entry, coordinator
