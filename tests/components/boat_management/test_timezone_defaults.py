"""Tests for the Home-Assistant-timezone default policy (DESIGN.md)."""

from __future__ import annotations

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.boat_management.const import (
    CONF_DEFAULT_TIMEZONE,
    CONF_VESSEL_NAME,
    DOMAIN,
)


async def test_new_vessel_defaults_to_ha_timezone(hass: HomeAssistant) -> None:
    """A vessel created without an explicit timezone inherits HA's."""
    hass.config.set_time_zone("Pacific/Auckland")

    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Onboard",
        data={CONF_VESSEL_NAME: "Onboard"},  # no timezone provided
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    coordinator = hass.data[DOMAIN][entry.entry_id]
    assert coordinator.data.vessel.current_timezone == "Pacific/Auckland"
    assert coordinator.data.vessel.default_timezone == "Pacific/Auckland"
    assert coordinator.active_timezone == "Pacific/Auckland"


async def test_active_timezone_prefers_override(
    hass: HomeAssistant, setup_vessel
) -> None:
    """A manual/GPS override is authoritative over the HA default."""
    hass.config.set_time_zone("Pacific/Auckland")
    _entry, coordinator = setup_vessel

    # Fixture sets Europe/Paris; override wins over HA timezone.
    assert coordinator.data.vessel.current_timezone == "Europe/Paris"
    assert coordinator.active_timezone == "Europe/Paris"


async def test_active_timezone_falls_back_when_unset(
    hass: HomeAssistant, setup_vessel
) -> None:
    hass.config.set_time_zone("Pacific/Auckland")
    _entry, coordinator = setup_vessel

    coordinator.data.vessel.current_timezone = ""
    assert coordinator.active_timezone == "Pacific/Auckland"


async def test_config_flow_defaults_timezone_to_ha(hass: HomeAssistant) -> None:
    """Omitting the timezone in the user step falls back to HA's."""
    hass.config.set_time_zone("Pacific/Auckland")

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_VESSEL_NAME: "Argo"}
    )
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_DEFAULT_TIMEZONE] == "Pacific/Auckland"
