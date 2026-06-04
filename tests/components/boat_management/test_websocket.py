"""Tests for the read-only websocket API and its pure search helper."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from custom_components.boat_management.const import DOMAIN, SERVICE_CREATE_SYSTEM
from custom_components.boat_management.search import filter_serialized

# --- Pure search helper -----------------------------------------------------
_ITEMS = {
    "a": {"name": "Propulsion", "category": "mechanical"},
    "b": {"name": "Electrical", "category": "electrical"},
    "c": {"name": "Fresh Water", "tags": ["plumbing", "potable"]},
}


def test_filter_no_args_returns_all() -> None:
    assert filter_serialized(_ITEMS) == _ITEMS


def test_filter_query_is_case_insensitive() -> None:
    result = filter_serialized(_ITEMS, query="ELECTRIC")
    assert set(result) == {"b"}


def test_filter_query_searches_nested_values() -> None:
    result = filter_serialized(_ITEMS, query="potable")
    assert set(result) == {"c"}


def test_filter_limit_caps_results_in_order() -> None:
    result = filter_serialized(_ITEMS, limit=2)
    assert list(result) == ["a", "b"]


def test_filter_non_positive_limit_returns_none() -> None:
    assert filter_serialized(_ITEMS, limit=0) == {}


def test_filter_query_and_limit_combined() -> None:
    result = filter_serialized(_ITEMS, query="e", limit=1)
    # "Propulsion" has no 'e'; first match is Electrical, capped at 1.
    assert len(result) == 1


# --- HA harness -------------------------------------------------------------
# The websocket commands are exercised by validating a message through the
# command's own schema and invoking the handler with a recording connection.
# This avoids spinning up the full HTTP/auth server (and its unrelated optional
# dependencies) while still testing the real handler + schema.
from custom_components.boat_management import websocket_api as ws  # noqa: E402


class _FakeUser:
    def __init__(self, user_id: str = "test-user") -> None:
        self.id = user_id


class _FakeConnection:
    def __init__(self, user: _FakeUser | None = None) -> None:
        self.results: dict[int, object] = {}
        self.errors: dict[int, tuple[str, str]] = {}
        self.messages: list[dict] = []
        self.subscriptions: dict[int, object] = {}
        self.user = user if user is not None else _FakeUser()

    def send_result(self, msg_id: int, result: object = None) -> None:
        self.results[msg_id] = result

    def send_error(self, msg_id: int, code: str, message: str) -> None:
        self.errors[msg_id] = (code, message)

    def send_message(self, message: dict) -> None:
        self.messages.append(message)


def _call(hass: HomeAssistant, handler, raw: dict) -> _FakeConnection:
    msg = handler._ws_schema(raw)
    conn = _FakeConnection()
    handler(hass, conn, msg)
    return conn


async def _call_write(hass: HomeAssistant, handler, raw: dict) -> _FakeConnection:
    """Invoke an async write command's underlying coroutine with a fake conn.

    ``async_response`` wraps the real handler; ``__wrapped__`` exposes the raw
    coroutine so we exercise the true handler + schema without the transport.
    """
    msg = handler._ws_schema(raw)
    conn = _FakeConnection()
    await handler.__wrapped__(hass, conn, msg)
    return conn


async def _seed_systems(hass: HomeAssistant) -> None:
    for name in ("Propulsion", "Electrical", "Navigation"):
        await hass.services.async_call(
            DOMAIN, SERVICE_CREATE_SYSTEM, {"name": name}, blocking=True
        )


async def test_ws_list_returns_items(hass: HomeAssistant, setup_vessel) -> None:
    await _seed_systems(hass)
    conn = _call(
        hass,
        ws.ws_list_collection,
        {"id": 1, "type": "boat_management/list", "collection": "systems"},
    )
    result = conn.results[1]
    assert result["total"] == 3
    assert result["count"] == 3
    assert len(result["items"]) == 3


async def test_ws_list_query_filters(hass: HomeAssistant, setup_vessel) -> None:
    await _seed_systems(hass)
    conn = _call(
        hass,
        ws.ws_list_collection,
        {
            "id": 2,
            "type": "boat_management/list",
            "collection": "systems",
            "query": "nav",
        },
    )
    result = conn.results[2]
    assert result["total"] == 3
    assert result["count"] == 1
    names = [v["name"] for v in result["items"].values()]
    assert names == ["Navigation"]


async def test_ws_list_limit_caps(hass: HomeAssistant, setup_vessel) -> None:
    await _seed_systems(hass)
    conn = _call(
        hass,
        ws.ws_list_collection,
        {"id": 3, "type": "boat_management/list", "collection": "systems", "limit": 1},
    )
    result = conn.results[3]
    assert result["count"] == 1
    assert result["total"] == 3


async def test_ws_overview_returns_diagnostics(
    hass: HomeAssistant, setup_vessel
) -> None:
    conn = _call(
        hass, ws.ws_get_overview, {"id": 4, "type": "boat_management/overview"}
    )
    assert "object_counts" in conn.results[4]


async def test_ws_list_unknown_entry_sends_error(
    hass: HomeAssistant, setup_vessel
) -> None:
    conn = _call(
        hass,
        ws.ws_list_collection,
        {
            "id": 5,
            "type": "boat_management/list",
            "collection": "systems",
            "entry_id": "does-not-exist",
        },
    )
    assert 5 in conn.errors
    assert conn.errors[5][0] == "not_found"


async def test_ws_export_returns_envelope(hass: HomeAssistant, setup_vessel) -> None:
    await _seed_systems(hass)
    conn = _call(hass, ws.ws_export, {"id": 6, "type": "boat_management/export"})
    result = conn.results[6]
    assert result["export_schema_version"] == 1
    assert len(result["collections"]["systems"]) == 3


async def test_ws_export_can_exclude_logbook(hass: HomeAssistant, setup_vessel) -> None:
    conn = _call(
        hass,
        ws.ws_export,
        {"id": 7, "type": "boat_management/export", "include_logbook": False},
    )
    assert conn.results[7]["collections"]["maintenance_log"] == {}


async def test_ws_export_logbook(hass: HomeAssistant, setup_vessel) -> None:
    conn = _call(
        hass, ws.ws_export_logbook, {"id": 8, "type": "boat_management/export_logbook"}
    )
    assert "maintenance_log" in conn.results[8]


async def test_ws_import_preview_is_dry_run(hass: HomeAssistant, setup_vessel) -> None:
    _entry, coordinator = setup_vessel
    await _seed_systems(hass)
    export = _call(hass, ws.ws_export, {"id": 9, "type": "boat_management/export"})
    payload = export.results[9]

    conn = _call(
        hass,
        ws.ws_import_preview,
        {"id": 10, "type": "boat_management/import_preview", "payload": payload},
    )
    report = conn.results[10]
    assert report["dry_run"] is True
    assert report["mode"] == "merge"
    # Preview must not have mutated state.
    assert len(coordinator.data.systems) == 3


async def test_ws_import_preview_invalid_payload_errors(
    hass: HomeAssistant, setup_vessel
) -> None:
    conn = _call(
        hass,
        ws.ws_import_preview,
        {"id": 11, "type": "boat_management/import_preview", "payload": {}},
    )
    assert conn.errors[11][0] == "invalid_payload"


# --- Bootstrap --------------------------------------------------------------
async def test_ws_bootstrap_returns_full_snapshot(
    hass: HomeAssistant, setup_vessel
) -> None:
    await _seed_systems(hass)
    conn = _call(hass, ws.ws_bootstrap, {"id": 12, "type": "boat_management/bootstrap"})
    payload = conn.results[12]
    assert payload["vessel"]["id"]
    assert payload["active_timezone"]
    assert payload["schema_version"] == 1
    assert payload["counts"]["systems"] == 3
    assert len(payload["collections"]["systems"]) == 3
    # Every managed collection must be present, even when empty.
    assert "maintenance_log" in payload["collections"]


async def test_ws_bootstrap_unknown_entry_errors(
    hass: HomeAssistant, setup_vessel
) -> None:
    conn = _call(
        hass,
        ws.ws_bootstrap,
        {"id": 13, "type": "boat_management/bootstrap", "entry_id": "nope"},
    )
    assert conn.errors[13][0] == "not_found"


# --- Write commands ---------------------------------------------------------
def _write(name: str):
    return ws.WRITE_COMMANDS[f"boat_management/{name}"]


async def test_ws_create_system_returns_object_with_id(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    conn = await _call_write(
        hass,
        _write("create_system"),
        {"id": 14, "type": "boat_management/create_system", "name": "Rigging"},
    )
    result = conn.results[14]
    # Server assigns the stable id; the panel never invents one.
    assert result["id"]
    assert result["name"] == "Rigging"
    assert result["id"] in coordinator.data.systems


async def test_ws_create_system_records_actor_from_connection(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_system"),
        {"id": 15, "type": "boat_management/create_system", "name": "Safety"},
    )
    system_id = created.results[15]["id"]
    # The authenticated websocket user is recorded for the audit trail.
    actors = {
        e.actor
        for e in coordinator.data.audit_events.values()
        if e.object_id == system_id
    }
    assert actors == {"test-user"}


async def test_ws_create_system_validation_error_is_structured(
    hass: HomeAssistant, setup_vessel
) -> None:
    conn = await _call_write(
        hass,
        _write("create_system"),
        {"id": 16, "type": "boat_management/create_system", "name": "  "},
    )
    assert 16 not in conn.results
    assert conn.errors[16][0] == "invalid_request"


async def test_ws_update_system_applies_changes(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_system"),
        {"id": 17, "type": "boat_management/create_system", "name": "Old"},
    )
    system_id = created.results[17]["id"]
    conn = await _call_write(
        hass,
        _write("update_system"),
        {
            "id": 18,
            "type": "boat_management/update_system",
            "system_id": system_id,
            "changes": {"name": "New"},
        },
    )
    assert conn.results[18]["name"] == "New"
    assert coordinator.data.systems[system_id].name == "New"


async def test_ws_archive_system_marks_inactive(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_system"),
        {"id": 19, "type": "boat_management/create_system", "name": "Tender"},
    )
    system_id = created.results[19]["id"]
    conn = await _call_write(
        hass,
        _write("archive_system"),
        {
            "id": 20,
            "type": "boat_management/archive_system",
            "system_id": system_id,
        },
    )
    assert conn.results[20]["active"] is False
    assert coordinator.data.systems[system_id].active is False


async def test_ws_create_inventory_item_roundtrips(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    conn = await _call_write(
        hass,
        _write("create_inventory_item"),
        {
            "id": 21,
            "type": "boat_management/create_inventory_item",
            "name": "Impeller",
            "quantity": 4,
            "unit": "ea",
        },
    )
    result = conn.results[21]
    assert result["name"] == "Impeller"
    assert result["id"] in coordinator.data.inventory


# --- Equipment & inventory writes (Phase 2) ---------------------------------
async def test_ws_create_equipment_with_documentation_refs(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    conn = await _call_write(
        hass,
        _write("create_equipment"),
        {
            "id": 30,
            "type": "boat_management/create_equipment",
            "name": "Port Engine",
            "documentation_refs": ["https://manuals/engine.pdf", "doc-42"],
            "maintenance_interval_days": 180,
        },
    )
    result = conn.results[30]
    assert result["id"] in coordinator.data.equipment
    # Documentation references are opaque strings preserved verbatim.
    assert result["documentation_refs"] == ["https://manuals/engine.pdf", "doc-42"]
    assert result["maintenance_interval_days"] == 180


async def test_ws_create_equipment_links_inventory(
    hass: HomeAssistant, setup_vessel
) -> None:
    inv = await _call_write(
        hass,
        _write("create_inventory_item"),
        {
            "id": 31,
            "type": "boat_management/create_inventory_item",
            "name": "Oil filter",
            "quantity": 6,
        },
    )
    inv_id = inv.results[31]["id"]
    conn = await _call_write(
        hass,
        _write("create_equipment"),
        {
            "id": 32,
            "type": "boat_management/create_equipment",
            "name": "Generator",
            "inventory_refs": [inv_id],
        },
    )
    assert conn.results[32]["inventory_refs"] == [inv_id]


async def test_ws_create_equipment_bad_system_errors(
    hass: HomeAssistant, setup_vessel
) -> None:
    conn = await _call_write(
        hass,
        _write("create_equipment"),
        {
            "id": 33,
            "type": "boat_management/create_equipment",
            "name": "Windlass",
            "system_id": "sys-does-not-exist",
        },
    )
    assert 33 not in conn.results
    assert conn.errors[33][0] == "invalid_request"


async def test_ws_update_equipment_applies_changes(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_equipment"),
        {"id": 34, "type": "boat_management/create_equipment", "name": "Old Pump"},
    )
    eq_id = created.results[34]["id"]
    conn = await _call_write(
        hass,
        _write("update_equipment"),
        {
            "id": 35,
            "type": "boat_management/update_equipment",
            "equipment_id": eq_id,
            "changes": {"name": "New Pump", "documentation_refs": ["m1"]},
        },
    )
    assert conn.results[35]["name"] == "New Pump"
    assert coordinator.data.equipment[eq_id].documentation_refs == ["m1"]


async def test_ws_retire_equipment_marks_inactive(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_equipment"),
        {"id": 36, "type": "boat_management/create_equipment", "name": "Old Radar"},
    )
    eq_id = created.results[36]["id"]
    conn = await _call_write(
        hass,
        _write("retire_equipment"),
        {"id": 37, "type": "boat_management/retire_equipment", "equipment_id": eq_id},
    )
    assert conn.results[37]["active"] is False
    assert coordinator.data.equipment[eq_id].active is False
    # Retiring stamps a date so history stays resolvable.
    assert coordinator.data.equipment[eq_id].retired_date


async def test_ws_update_inventory_item_applies_changes(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_inventory_item"),
        {
            "id": 38,
            "type": "boat_management/create_inventory_item",
            "name": "Impeller",
            "quantity": 3,
        },
    )
    inv_id = created.results[38]["id"]
    conn = await _call_write(
        hass,
        _write("update_inventory_item"),
        {
            "id": 39,
            "type": "boat_management/update_inventory_item",
            "inventory_id": inv_id,
            "changes": {"storage_location": "Locker B", "minimum_stock": "2"},
        },
    )
    assert conn.results[39]["storage_location"] == "Locker B"
    assert coordinator.data.inventory[inv_id].storage_location == "Locker B"


async def test_ws_adjust_inventory_quantity_changes_stock(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_inventory_item"),
        {
            "id": 40,
            "type": "boat_management/create_inventory_item",
            "name": "Coolant",
            "quantity": 5,
        },
    )
    inv_id = created.results[40]["id"]
    conn = await _call_write(
        hass,
        _write("adjust_inventory_quantity"),
        {
            "id": 41,
            "type": "boat_management/adjust_inventory_quantity",
            "inventory_id": inv_id,
            "delta": "-2",
        },
    )
    assert conn.results[41]["quantity"] == "3"
    assert str(coordinator.data.inventory[inv_id].quantity) == "3"


async def test_ws_adjust_inventory_below_zero_errors(
    hass: HomeAssistant, setup_vessel
) -> None:
    created = await _call_write(
        hass,
        _write("create_inventory_item"),
        {
            "id": 42,
            "type": "boat_management/create_inventory_item",
            "name": "Zinc anode",
            "quantity": 1,
        },
    )
    inv_id = created.results[42]["id"]
    conn = await _call_write(
        hass,
        _write("adjust_inventory_quantity"),
        {
            "id": 43,
            "type": "boat_management/adjust_inventory_quantity",
            "inventory_id": inv_id,
            "delta": "-5",
        },
    )
    assert 43 not in conn.results
    assert conn.errors[43][0] == "invalid_request"


async def test_ws_mark_inventory_expired_sets_flag(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    created = await _call_write(
        hass,
        _write("create_inventory_item"),
        {
            "id": 44,
            "type": "boat_management/create_inventory_item",
            "name": "Flares",
            "quantity": 4,
        },
    )
    inv_id = created.results[44]["id"]
    conn = await _call_write(
        hass,
        _write("mark_inventory_expired"),
        {
            "id": 45,
            "type": "boat_management/mark_inventory_expired",
            "inventory_id": inv_id,
        },
    )
    assert conn.results[45]["expired"] is True
    assert coordinator.data.inventory[inv_id].expired is True


# --- Live subscription ------------------------------------------------------
async def test_ws_subscribe_pushes_on_change(hass: HomeAssistant, setup_vessel) -> None:
    msg = ws.ws_subscribe._ws_schema({"id": 22, "type": "boat_management/subscribe"})
    conn = _FakeConnection()
    ws.ws_subscribe(hass, conn, msg)
    # Subscribe acknowledges and registers an unsub.
    assert 22 in conn.results
    assert 22 in conn.subscriptions

    # A mutation through the normal write path should push a change event.
    await _seed_systems(hass)
    events = [m for m in conn.messages if m.get("type") == "event"]
    assert events
    assert events[0]["event"]["event"] == "changed"


async def test_ws_subscribe_unsub_stops_pushes(
    hass: HomeAssistant, setup_vessel
) -> None:
    msg = ws.ws_subscribe._ws_schema({"id": 23, "type": "boat_management/subscribe"})
    conn = _FakeConnection()
    ws.ws_subscribe(hass, conn, msg)
    conn.subscriptions[23]()  # unsubscribe
    await _seed_systems(hass)
    assert not [m for m in conn.messages if m.get("type") == "event"]


async def test_ws_subscribe_unknown_entry_errors(
    hass: HomeAssistant, setup_vessel
) -> None:
    msg = ws.ws_subscribe._ws_schema(
        {"id": 24, "type": "boat_management/subscribe", "entry_id": "nope"}
    )
    conn = _FakeConnection()
    ws.ws_subscribe(hass, conn, msg)
    assert conn.errors[24][0] == "not_found"
