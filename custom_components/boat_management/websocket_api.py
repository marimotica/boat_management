"""Websocket API backing the custom panel (reads, writes, and live push).

Handlers are thin (AGENTS.md): they resolve the target coordinator, delegate to
the same pure domain operations used by the services layer via
``coordinator.async_execute`` (which persists + audits in one place), and turn
domain errors into structured websocket errors. No business logic lives here.

Write commands return the full serialized object (including its server-assigned
stable id) so the panel never has to invent ids and can reconcile optimistic UI
state. ``boat_management/subscribe`` pushes a change event whenever vessel state
mutates, so the panel stays live without polling.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
import voluptuous as vol

from . import (
    equipment as equipment_ops,
    inventory as inventory_ops,
    systems as systems_ops,
    task_catalogue as catalogue_ops,
)
from .const import DOMAIN, STORAGE_VERSION
from .coordinator import BoatCoordinator
from .diagnostics import build_diagnostics
from .import_export import (
    ImportError_,
    apply_import,
    export_logbook_payload,
    export_payload,
)
from .search import filter_serialized
from .transitions import TransitionError
from .validators import ValidationError

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
    websocket_api.async_register_command(hass, ws_bootstrap)
    websocket_api.async_register_command(hass, ws_list_collection)
    websocket_api.async_register_command(hass, ws_export)
    websocket_api.async_register_command(hass, ws_export_logbook)
    websocket_api.async_register_command(hass, ws_import_preview)
    websocket_api.async_register_command(hass, ws_subscribe)
    for handler in WRITE_COMMANDS.values():
        websocket_api.async_register_command(hass, handler)


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


def _bootstrap_payload(coordinator: BoatCoordinator) -> dict[str, Any]:
    """Full initial snapshot the panel loads once on connect.

    Includes the vessel, every managed collection, the resolved active timezone
    (vessel override or Home Assistant's onboard timezone), and per-collection
    counts so the panel can render without a flurry of follow-up requests.
    """
    data = coordinator.data
    collections = {
        name: {k: v.to_dict() for k, v in getattr(data, name).items()}
        for name in _LIST_COLLECTIONS
    }
    return {
        "entry_id": coordinator.entry.entry_id,
        "vessel": data.vessel.to_dict(),
        "active_timezone": coordinator.active_timezone,
        "schema_version": STORAGE_VERSION,
        "collections": collections,
        "counts": {name: len(items) for name, items in collections.items()},
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): "boat_management/bootstrap",
        vol.Optional("entry_id"): str,
    }
)
@callback
def ws_bootstrap(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return a single full snapshot for the panel to initialize from."""
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return
    connection.send_result(msg["id"], _bootstrap_payload(coordinator))


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


# ---------------------------------------------------------------------------
# Live subscription: push a change event whenever vessel state mutates.
# ---------------------------------------------------------------------------
@websocket_api.websocket_command(
    {
        vol.Required("type"): "boat_management/subscribe",
        vol.Optional("entry_id"): str,
    }
)
@callback
def ws_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Subscribe to vessel state changes.

    Reuses the coordinator's existing listener fan-out (the same one entities
    use), so the panel is notified on every persisted mutation. The payload is
    intentionally a lightweight signal; the panel re-reads the collections it
    cares about. This keeps push simple and avoids leaking partial diffs.
    """
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return

    @callback
    def _forward_change() -> None:
        connection.send_message(
            websocket_api.event_message(
                msg["id"],
                {"event": "changed", "entry_id": coordinator.entry.entry_id},
            )
        )

    connection.subscriptions[msg["id"]] = coordinator.async_add_listener(
        _forward_change
    )
    connection.send_result(msg["id"])


# ---------------------------------------------------------------------------
# Write commands: thin adapters over the same pure domain ops the services use.
# Each returns the full serialized object so the panel gets the server-assigned
# stable id back (it never invents ids) and can reconcile optimistic state.
# ---------------------------------------------------------------------------
def _pick(msg: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    """Collect the present subset of ``keys`` from a validated message."""
    return {key: msg[key] for key in keys if key in msg}


def _serialize_result(result: Any) -> Any:
    """Serialize a domain op result for transport (full object when possible)."""
    if hasattr(result, "to_dict"):
        return result.to_dict()
    return result


async def _execute_write(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    op: Callable[..., Any],
    arg_map: Callable[[dict[str, Any]], dict[str, Any]],
) -> None:
    """Resolve the vessel, run a pure op under the coordinator lock, reply.

    Domain validation/transition errors are surfaced as structured websocket
    errors so the panel can show actionable messages instead of a generic
    failure. The actor is the authenticated websocket user, for the audit trail.
    """
    coordinator = _resolve(hass, msg.get("entry_id"))
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No matching vessel")
        return
    kwargs = arg_map(msg)
    kwargs["actor"] = connection.user.id if connection.user else None
    try:
        result = await coordinator.async_execute(op, **kwargs)
    except (ValidationError, TransitionError) as err:
        connection.send_error(msg["id"], "invalid_request", str(err))
        return
    connection.send_result(msg["id"], _serialize_result(result))


def _build_write_command(
    command_type: str,
    fields: dict[Any, Any],
    op: Callable[..., Any],
    arg_map: Callable[[dict[str, Any]], dict[str, Any]],
) -> Callable[..., Any]:
    """Build a registered async websocket write command.

    Returns the schedule wrapper produced by ``async_response``; its
    ``__wrapped__`` is the raw coroutine, which keeps the handler unit-testable
    without standing up the full websocket transport.
    """
    schema = {
        vol.Required("type"): command_type,
        vol.Optional("entry_id"): str,
        **fields,
    }

    async def _handler(
        hass: HomeAssistant,
        connection: websocket_api.ActiveConnection,
        msg: dict[str, Any],
    ) -> None:
        await _execute_write(hass, connection, msg, op, arg_map)

    _handler.__name__ = command_type.replace("/", "_").replace("-", "_")
    wrapped = websocket_api.async_response(_handler)
    return websocket_api.websocket_command(schema)(wrapped)


# Field schemas mirror the service write API (services.py) so both controlled
# write surfaces validate identically; the domain ops remain the single source
# of truth for what the fields mean.
_CHANGES = {vol.Required("changes"): dict}

_WRITE_SPECS: tuple[tuple[str, dict[Any, Any], Callable[..., Any], Any], ...] = (
    # Systems --------------------------------------------------------------
    (
        "boat_management/create_system",
        {
            vol.Required("name"): str,
            vol.Optional("category"): str,
            vol.Optional("description"): str,
            vol.Optional("parent_system_id"): str,
        },
        systems_ops.create_system,
        lambda m: _pick(m, ("name", "category", "description", "parent_system_id")),
    ),
    (
        "boat_management/update_system",
        {vol.Required("system_id"): str, **_CHANGES},
        systems_ops.update_system,
        lambda m: {"system_id": m["system_id"], "changes": m["changes"]},
    ),
    (
        "boat_management/archive_system",
        {vol.Required("system_id"): str},
        systems_ops.archive_system,
        lambda m: {"system_id": m["system_id"]},
    ),
    # Equipment ------------------------------------------------------------
    (
        "boat_management/create_equipment",
        {
            vol.Required("name"): str,
            vol.Optional("system_id"): str,
            vol.Optional("inventory_refs"): [str],
            vol.Optional("documentation_refs"): [str],
            vol.Optional("category"): str,
            vol.Optional("manufacturer"): str,
            vol.Optional("model"): str,
            vol.Optional("serial_number"): str,
            vol.Optional("location"): str,
            vol.Optional("installed_date"): str,
            vol.Optional("commissioned_date"): str,
            vol.Optional("maintenance_interval_days"): vol.Coerce(int),
        },
        equipment_ops.create_equipment,
        lambda m: _pick(
            m,
            (
                "name",
                "system_id",
                "inventory_refs",
                "documentation_refs",
                "category",
                "manufacturer",
                "model",
                "serial_number",
                "location",
                "installed_date",
                "commissioned_date",
                "maintenance_interval_days",
            ),
        ),
    ),
    (
        "boat_management/update_equipment",
        {vol.Required("equipment_id"): str, **_CHANGES},
        equipment_ops.update_equipment,
        lambda m: {"equipment_id": m["equipment_id"], "changes": m["changes"]},
    ),
    (
        "boat_management/retire_equipment",
        {vol.Required("equipment_id"): str, vol.Optional("retired_date"): str},
        equipment_ops.retire_equipment,
        lambda m: _pick(m, ("equipment_id", "retired_date")),
    ),
    # Inventory ------------------------------------------------------------
    (
        "boat_management/create_inventory_item",
        {
            vol.Required("name"): str,
            vol.Optional("quantity"): vol.Coerce(str),
            vol.Optional("unit"): str,
            vol.Optional("equipment_refs"): [str],
            vol.Optional("minimum_stock"): vol.Coerce(str),
            vol.Optional("reorder_level"): vol.Coerce(str),
            vol.Optional("category"): str,
            vol.Optional("part_number"): str,
            vol.Optional("storage_location"): str,
            vol.Optional("expiry_date"): str,
        },
        inventory_ops.create_inventory_item,
        lambda m: _pick(
            m,
            (
                "name",
                "quantity",
                "unit",
                "equipment_refs",
                "minimum_stock",
                "reorder_level",
                "category",
                "part_number",
                "storage_location",
                "expiry_date",
            ),
        ),
    ),
    (
        "boat_management/update_inventory_item",
        {vol.Required("inventory_id"): str, **_CHANGES},
        inventory_ops.update_inventory_item,
        lambda m: {"inventory_id": m["inventory_id"], "changes": m["changes"]},
    ),
    (
        "boat_management/adjust_inventory_quantity",
        {
            vol.Required("inventory_id"): str,
            vol.Required("delta"): vol.Coerce(str),
            vol.Optional("reason"): str,
        },
        inventory_ops.adjust_inventory_quantity,
        lambda m: _pick(m, ("inventory_id", "delta", "reason")),
    ),
    (
        "boat_management/mark_inventory_expired",
        {vol.Required("inventory_id"): str},
        inventory_ops.mark_inventory_expired,
        lambda m: {"inventory_id": m["inventory_id"]},
    ),
    # Task catalogue -------------------------------------------------------
    (
        "boat_management/create_catalogue_task",
        {
            vol.Required("title"): str,
            vol.Optional("description"): str,
            vol.Optional("system_refs"): [str],
            vol.Optional("equipment_refs"): [str],
            vol.Optional("inventory_refs"): [str],
            vol.Optional("required_skills"): [str],
            vol.Optional("estimated_duration_minutes"): vol.Coerce(int),
            vol.Optional("procedure"): str,
            vol.Optional("safety_notes"): str,
            vol.Optional("default_verifier"): str,
            vol.Optional("trigger_rules"): [dict],
        },
        catalogue_ops.create_catalogue_task,
        lambda m: _pick(
            m,
            (
                "title",
                "description",
                "system_refs",
                "equipment_refs",
                "inventory_refs",
                "required_skills",
                "estimated_duration_minutes",
                "procedure",
                "safety_notes",
                "default_verifier",
                "trigger_rules",
            ),
        ),
    ),
    (
        "boat_management/update_catalogue_task",
        {vol.Required("catalogue_task_id"): str, **_CHANGES},
        catalogue_ops.update_catalogue_task,
        lambda m: {
            "catalogue_task_id": m["catalogue_task_id"],
            "changes": m["changes"],
        },
    ),
    (
        "boat_management/archive_catalogue_task",
        {vol.Required("catalogue_task_id"): str},
        catalogue_ops.archive_catalogue_task,
        lambda m: {"catalogue_task_id": m["catalogue_task_id"]},
    ),
)

# Public mapping of command type -> registered handler (used by registration
# and by tests, which invoke ``handler.__wrapped__`` directly).
WRITE_COMMANDS: dict[str, Callable[..., Any]] = {
    command_type: _build_write_command(command_type, fields, op, arg_map)
    for command_type, fields, op, arg_map in _WRITE_SPECS
}
