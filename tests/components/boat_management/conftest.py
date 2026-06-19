"""Fixtures for boat_management HA harness tests."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.boat_management.const import (
    CONF_VESSEL_NAME,
    DOMAIN,
)


@pytest.fixture
async def setup_vessel(hass: HomeAssistant):
    """Set up a configured vessel and return (entry, coordinator).

    The HA timezone is set to Europe/Paris so that tests that inspect
    ``vessel.current_timezone`` get a consistent value without needing to
    store a timezone in the config entry.
    """
    hass.config.set_time_zone("Europe/Paris")
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Test Vessel",
        data={
            CONF_VESSEL_NAME: "Test Vessel",
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = hass.data[DOMAIN][entry.entry_id]
    return entry, coordinator
