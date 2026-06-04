"""Custom panel registration for the Boat Management frontend.

Serves the committed Lit bundle as a static file and registers a sidebar
panel pointing at it. The integration ships a *built* artifact (HACS/manual
installs cannot run a JS toolchain), so this module only wires it into Home
Assistant; it owns no business logic.

Registration is process-global and idempotent:

* The static route is registered once per Home Assistant process (it cannot be
  cleanly removed, and re-registering the same aiohttp route raises), tracked
  with a stable key that survives the per-domain ``hass.data`` teardown.
* The sidebar panel is registered on first entry setup and removed when the
  last entry unloads, mirroring how services are managed.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.core import HomeAssistant, callback

from .const import (
    DOMAIN,
    PANEL_BUNDLE_FILENAME,
    PANEL_ICON,
    PANEL_STATIC_URL,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
)

_LOGGER = logging.getLogger(__name__)

# Stable top-level hass.data keys; intentionally NOT under DOMAIN so they do not
# pollute the coordinator registry (hass.data[DOMAIN] maps entry_id -> coordinator
# and is iterated/sized by the services and websocket resolvers) and so the
# static-route flag survives the DOMAIN teardown on last-entry unload.
_STATIC_REGISTERED: str = f"{DOMAIN}_static_registered"
_PANEL_REGISTERED: str = f"{DOMAIN}_panel_registered"

_BUNDLE_PATH = Path(__file__).parent / "frontend" / PANEL_BUNDLE_FILENAME


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the static bundle and sidebar panel (idempotent)."""
    if not _BUNDLE_PATH.is_file():
        # The integration still works fully via services/websocket without the
        # UI; make the cause obvious rather than failing setup.
        _LOGGER.warning(
            "Boat Management panel bundle missing at %s; the custom panel is "
            "disabled. Build the frontend to enable it.",
            _BUNDLE_PATH,
        )
        return

    # Static route: once per process.
    if not hass.data.get(_STATIC_REGISTERED):
        # cache_headers=False so an upgraded bundle is picked up without a hard
        # refresh; the file is tiny and served from local disk.
        hass.http.register_static_path(
            PANEL_STATIC_URL, str(_BUNDLE_PATH), cache_headers=False
        )
        hass.data[_STATIC_REGISTERED] = True

    # Sidebar panel: once per domain. Tracked outside hass.data[DOMAIN] so the
    # coordinator registry stays a clean entry_id -> coordinator mapping.
    if hass.data.get(_PANEL_REGISTERED):
        return

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_WEBCOMPONENT,
        module_url=PANEL_STATIC_URL,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        embed_iframe=False,
    )
    hass.data[_PANEL_REGISTERED] = True


@callback
def async_unregister_panel(hass: HomeAssistant) -> None:
    """Remove the sidebar panel (static route persists for the process)."""
    if not hass.data.get(_PANEL_REGISTERED):
        return
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    hass.data[_PANEL_REGISTERED] = False
