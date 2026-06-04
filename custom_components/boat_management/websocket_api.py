"""Websocket API for future custom panels (read-only projections).

Handlers are thin and return serialized snapshots of vessel state. Writes still
go through services so audit/validation rules are enforced in one place. This
API is optional; the integration is fully usable without it.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
import voluptuous as vol

from .const import DOMAIN
from .coordinator import BoatCoordinator
from .diagnostics import build_diagnostics
from .import_export import (
    ImportError_,
    apply_import,
    export_logbook_payload,
    export_payload,
)
from .search import filter_serialized

_LIST_COLLECTIONS = (
    "systems",
    "equipment",
    "inventory",
    "task_catalogue",
    "work_items",
    "maintenance_log",
    "crew",
)


def _resolve(hass: HomeAssistant, entry_id: str | None) -> BoatCoordinator | None:
    domain_data: dict[str, BoatCoordinator] = hass.data.get(DOMAIN, {})
    if not domain_data:
        return None
    if entry_id:
        return domain_data.get(entry_id)
    if len(domain_data) == 1:
        return next(iter(domain_data.values()))
    return None


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register websocket commands (idempotent)."""
    websocket_api.async_register_command(hass, ws_get_overview)
    websocket_api.async_register_command(hass, ws_list_collection)
    websocket_api.async_register_command(hass, ws_export)
    websocket_api.async_register_command(hass, ws_export_logbook)
    websocket_api.async_register_command(hass, ws_import_preview)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "boat_management/overview",
        vol.Optional("entry_id"): str,
    }
)
@callback
def ws_get_overview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return
    connection.send_result(msg["id"], build_diagnostics(coordinator))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "boat_management/list",
        vol.Required("collection"): vol.In(_LIST_COLLECTIONS),
        vol.Optional("entry_id"): str,
        vol.Optional("query"): str,
        vol.Optional("limit"): vol.All(int, vol.Range(min=1)),
    }
)
@callback
def ws_list_collection(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return
    collection = getattr(coordinator.data, msg["collection"])
    serialized = {k: v.to_dict() for k, v in collection.items()}
    items = filter_serialized(
        serialized, query=msg.get("query"), limit=msg.get("limit")
    )
    connection.send_result(
        msg["id"],
        {
            "collection": msg["collection"],
            "total": len(serialized),
            "count": len(items),
            "items": items,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "boat_management/export",
        vol.Optional("entry_id"): str,
        vol.Optional("include_logbook", default=True): bool,
    }
)
@callback
def ws_export(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return a full export envelope (read-only)."""
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return
    payload = export_payload(
        coordinator.data.to_dict(), include_logbook=msg["include_logbook"]
    )
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "boat_management/export_logbook",
        vol.Optional("entry_id"): str,
    }
)
@callback
def ws_export_logbook(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return only the immutable maintenance logbook (read-only)."""
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return
    connection.send_result(
        msg["id"], export_logbook_payload(coordinator.data.to_dict())
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "boat_management/import_preview",
        vol.Required("payload"): dict,
        vol.Optional("entry_id"): str,
        vol.Optional("mode", default="merge"): vol.In(("merge", "replace")),
    }
)
@callback
def ws_import_preview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Dry-run an import and return the report. Never mutates state.

    Actual imports go through the ``import_data`` service so writes stay in one
    audited place; this command only previews what an import would change.
    """
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return
    try:
        _result, report = apply_import(
            coordinator.data.to_dict(),
            msg["payload"],
            mode=msg["mode"],
            dry_run=True,
        )
    except ImportError_ as err:
        connection.send_error(msg["id"], "invalid_payload", str(err))
        return
    connection.send_result(msg["id"], report.to_dict())
