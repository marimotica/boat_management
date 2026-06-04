"""The Boat Management integration.

One config entry manages one vessel. Setup is idempotent; unload removes all
listeners cleanly; reload preserves storage and the entity registry. Business
logic lives in the pure domain modules and the :class:`BoatCoordinator`; this
module only wires Home Assistant lifecycle, platforms, and services.
"""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PLATFORMS
from .coordinator import BoatCoordinator
from .panel import async_register_panel, async_unregister_panel
from .repairs import async_evaluate_repairs
from .services import async_register_services, async_unregister_services
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up boat_management from a config entry."""
    coordinator = await BoatCoordinator.async_create(hass, entry)

    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Services and websocket API are registered once per domain.
    async_register_services(hass)
    async_register_websocket_api(hass)

    # Register the custom management panel (idempotent, once per domain).
    await async_register_panel(hass)

    # Surface any persisted invalid state as repair issues.
    async_evaluate_repairs(hass, coordinator)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry and clean up resources."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        domain_data = hass.data.get(DOMAIN, {})
        domain_data.pop(entry.entry_id, None)
        if not domain_data:
            async_unregister_services(hass)
            async_unregister_panel(hass)
            hass.data.pop(DOMAIN, None)
    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options change (e.g. vessel timezone)."""
    await hass.config_entries.async_reload(entry.entry_id)
