"""Tests for custom panel registration wiring.

These verify the panel is registered as a sidebar entry backed by the committed
bundle, that registration is idempotent, that teardown removes it, and -- most
importantly -- that the panel bookkeeping never pollutes ``hass.data[DOMAIN]``
(which must stay a clean entry_id -> coordinator map for the resolvers).
"""

from __future__ import annotations

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.boat_management.const import (
    CONF_VESSEL_NAME,
    DOMAIN,
    PANEL_URL_PATH,
)
from custom_components.boat_management.panel import (
    _PANEL_REGISTERED,
    _STATIC_REGISTERED,
    async_register_panel,
    async_unregister_panel,
)


def _panels(hass: HomeAssistant) -> dict:
    return hass.data.get(frontend.DATA_PANELS, {})


@pytest.fixture
async def http(hass: HomeAssistant) -> None:
    """Set up the http component so static-path registration has a server."""
    assert await async_setup_component(hass, "http", {})
    await hass.async_block_till_done()


async def test_register_panel_adds_sidebar_and_static(
    hass: HomeAssistant, http: None
) -> None:
    await async_register_panel(hass)
    assert PANEL_URL_PATH in _panels(hass)
    assert hass.data.get(_STATIC_REGISTERED) is True
    assert hass.data.get(_PANEL_REGISTERED) is True


async def test_register_panel_is_idempotent(hass: HomeAssistant, http: None) -> None:
    await async_register_panel(hass)
    # A second call must not raise (frontend would raise on duplicate paths).
    await async_register_panel(hass)
    assert PANEL_URL_PATH in _panels(hass)


async def test_unregister_panel_removes_sidebar(
    hass: HomeAssistant, http: None
) -> None:
    await async_register_panel(hass)
    async_unregister_panel(hass)
    assert PANEL_URL_PATH not in _panels(hass)
    assert hass.data.get(_PANEL_REGISTERED) is False
    # Static route persists for the life of the process.
    assert hass.data.get(_STATIC_REGISTERED) is True


async def test_unregister_without_register_is_noop(hass: HomeAssistant) -> None:
    async_unregister_panel(hass)  # must not raise
    assert PANEL_URL_PATH not in _panels(hass)


def _entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Test Vessel",
        data={CONF_VESSEL_NAME: "Test Vessel"},
    )


async def test_setup_registers_panel_without_polluting_domain_data(
    hass: HomeAssistant,
) -> None:
    entry = _entry()
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # Panel is live.
    assert PANEL_URL_PATH in _panels(hass)
    # DOMAIN data is exactly the coordinator registry: one entry, no flags. This
    # guards the services/websocket resolvers that size and iterate it.
    assert set(hass.data[DOMAIN]) == {entry.entry_id}

    # Unload removes the panel and tears down DOMAIN data.
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED
    assert PANEL_URL_PATH not in _panels(hass)
