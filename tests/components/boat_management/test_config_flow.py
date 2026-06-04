"""Tests for the config and options flow."""

from __future__ import annotations

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.boat_management.const import (
    CONF_CURRENT_TIMEZONE,
    CONF_DEFAULT_TIMEZONE,
    CONF_VESSEL_NAME,
    DOMAIN,
)


async def test_user_flow_creates_entry(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] == FlowResultType.FORM

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            CONF_VESSEL_NAME: "Argo",
            CONF_DEFAULT_TIMEZONE: "Europe/Paris",
            CONF_CURRENT_TIMEZONE: "Europe/Paris",
        },
    )
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["title"] == "Argo"
    assert result["data"][CONF_DEFAULT_TIMEZONE] == "Europe/Paris"


async def test_user_flow_rejects_invalid_timezone(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            CONF_VESSEL_NAME: "Argo",
            CONF_DEFAULT_TIMEZONE: "UTC+2",
        },
    )
    assert result["type"] == FlowResultType.FORM
    assert result["errors"][CONF_DEFAULT_TIMEZONE] == "invalid_timezone"


async def test_options_flow_updates_timezone(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={
            CONF_VESSEL_NAME: "Argo",
            CONF_DEFAULT_TIMEZONE: "Europe/Paris",
            CONF_CURRENT_TIMEZONE: "Europe/Paris",
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] == FlowResultType.FORM

    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            CONF_DEFAULT_TIMEZONE: "Europe/Paris",
            CONF_CURRENT_TIMEZONE: "America/New_York",
        },
    )
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert entry.options[CONF_CURRENT_TIMEZONE] == "America/New_York"
