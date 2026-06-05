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
from custom_components.boat_management.const import (  # noqa: E402
    WorkItemStatus,
)
from custom_components.boat_management.models import CrewMember  # noqa: E402


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


# --- Work item lifecycle writes (Phase 4) -----------------------------------
async def _seed_task(
    hass: HomeAssistant, msg_id: int, title: str = "Oil change"
) -> str:
    """Create a catalogue task via the write command and return its id."""
    created = await _call_write(
        hass,
        _write("create_catalogue_task"),
        {
            "id": msg_id,
            "type": "boat_management/create_catalogue_task",
            "title": title,
        },
    )
    return created.results[msg_id]["id"]


async def _create_work_item(hass: HomeAssistant, msg_id: int, task_id: str) -> str:
    created = await _call_write(
        hass,
        _write("create_work_item"),
        {
            "id": msg_id,
            "type": "boat_management/create_work_item",
            "catalogue_task_id": task_id,
        },
    )
    return created.results[msg_id]["id"]


async def test_ws_create_work_item_from_catalogue_task(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    task_id = await _seed_task(hass, 50)
    conn = await _call_write(
        hass,
        _write("create_work_item"),
        {
            "id": 51,
            "type": "boat_management/create_work_item",
            "catalogue_task_id": task_id,
        },
    )
    result = conn.results[51]
    assert result["id"] in coordinator.data.work_items
    assert result["status"] == WorkItemStatus.TODO.value
    # Title defaults to the catalogue task's title.
    assert result["title"] == "Oil change"


async def test_ws_create_work_item_unknown_task_errors(
    hass: HomeAssistant, setup_vessel
) -> None:
    conn = await _call_write(
        hass,
        _write("create_work_item"),
        {
            "id": 52,
            "type": "boat_management/create_work_item",
            "catalogue_task_id": "nope",
        },
    )
    assert 52 not in conn.results
    assert conn.errors[52][0] == "invalid_request"


async def test_ws_claim_work_item_assigns_crew(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.crew["c1"] = CrewMember(id="c1", name="Alex", role="crew")
    task_id = await _seed_task(hass, 53)
    wi_id = await _create_work_item(hass, 54, task_id)
    conn = await _call_write(
        hass,
        _write("claim_work_item"),
        {
            "id": 55,
            "type": "boat_management/claim_work_item",
            "work_item_id": wi_id,
            "crew_id": "c1",
        },
    )
    assert conn.results[55]["assigned_to"] == "c1"
    assert coordinator.data.work_items[wi_id].assigned_to == "c1"


async def test_ws_work_item_full_lifecycle_to_log_entry(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.crew["cap"] = CrewMember(id="cap", name="Captain", role="captain")
    task_id = await _seed_task(hass, 56)
    wi_id = await _create_work_item(hass, 57, task_id)
    await _call_write(
        hass,
        _write("start_work_item"),
        {"id": 58, "type": "boat_management/start_work_item", "work_item_id": wi_id},
    )
    await _call_write(
        hass,
        _write("submit_for_review"),
        {"id": 59, "type": "boat_management/submit_for_review", "work_item_id": wi_id},
    )
    conn = await _call_write(
        hass,
        _write("verify_work_item"),
        {
            "id": 60,
            "type": "boat_management/verify_work_item",
            "work_item_id": wi_id,
            "verified_by": "cap",
        },
    )
    # Verification returns the immutable maintenance log entry, not the item.
    entry = conn.results[60]
    assert entry["work_item_id"] == wi_id
    assert entry["id"] in coordinator.data.maintenance_log
    assert coordinator.data.work_items[wi_id].status == WorkItemStatus.DONE.value


async def test_ws_verify_by_non_verifier_role_errors(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.crew["deck"] = CrewMember(id="deck", name="Deckhand", role="crew")
    task_id = await _seed_task(hass, 61)
    wi_id = await _create_work_item(hass, 62, task_id)
    await _call_write(
        hass,
        _write("start_work_item"),
        {"id": 63, "type": "boat_management/start_work_item", "work_item_id": wi_id},
    )
    await _call_write(
        hass,
        _write("submit_for_review"),
        {"id": 64, "type": "boat_management/submit_for_review", "work_item_id": wi_id},
    )
    conn = await _call_write(
        hass,
        _write("verify_work_item"),
        {
            "id": 65,
            "type": "boat_management/verify_work_item",
            "work_item_id": wi_id,
            "verified_by": "deck",
        },
    )
    assert 65 not in conn.results
    assert conn.errors[65][0] == "invalid_request"
    # No history was written and the item stays in review (no partial writes).
    assert coordinator.data.maintenance_log == {}
    assert coordinator.data.work_items[wi_id].status == WorkItemStatus.REVIEW.value


async def test_ws_verify_consumes_submitted_inventory(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.crew["cap"] = CrewMember(id="cap", name="Captain", role="captain")
    task_id = await _seed_task(hass, 79)
    inv = await _call_write(
        hass,
        _write("create_inventory_item"),
        {
            "id": 80,
            "type": "boat_management/create_inventory_item",
            "name": "Engine oil",
            "quantity": 10,
        },
    )
    inv_id = inv.results[80]["id"]
    wi_id = await _create_work_item(hass, 81, task_id)
    await _call_write(
        hass,
        _write("start_work_item"),
        {"id": 82, "type": "boat_management/start_work_item", "work_item_id": wi_id},
    )
    await _call_write(
        hass,
        _write("submit_for_review"),
        {
            "id": 83,
            "type": "boat_management/submit_for_review",
            "work_item_id": wi_id,
            "inventory_used": [{"inventory_id": inv_id, "quantity": "3"}],
        },
    )
    await _call_write(
        hass,
        _write("verify_work_item"),
        {
            "id": 84,
            "type": "boat_management/verify_work_item",
            "work_item_id": wi_id,
            "verified_by": "cap",
        },
    )
    # Inventory is deducted on verification, not at submit time.
    assert str(coordinator.data.inventory[inv_id].quantity) == "7"


async def test_ws_block_then_unblock_work_item(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    task_id = await _seed_task(hass, 66)
    wi_id = await _create_work_item(hass, 67, task_id)
    blocked = await _call_write(
        hass,
        _write("block_work_item"),
        {
            "id": 68,
            "type": "boat_management/block_work_item",
            "work_item_id": wi_id,
            "block_reason": "waiting on part",
        },
    )
    assert blocked.results[68]["status"] == WorkItemStatus.BLOCKED.value
    assert blocked.results[68]["block_reason"] == "waiting on part"
    unblocked = await _call_write(
        hass,
        _write("unblock_work_item"),
        {
            "id": 69,
            "type": "boat_management/unblock_work_item",
            "work_item_id": wi_id,
        },
    )
    # Unblock clears the reason and returns to the active flow (todo by default).
    assert unblocked.results[69]["status"] == WorkItemStatus.TODO.value
    assert coordinator.data.work_items[wi_id].block_reason is None


async def test_ws_cancel_work_item(hass: HomeAssistant, setup_vessel) -> None:
    _entry, coordinator = setup_vessel
    task_id = await _seed_task(hass, 70)
    wi_id = await _create_work_item(hass, 71, task_id)
    conn = await _call_write(
        hass,
        _write("cancel_work_item"),
        {
            "id": 72,
            "type": "boat_management/cancel_work_item",
            "work_item_id": wi_id,
            "reason": "duplicate",
        },
    )
    assert conn.results[72]["status"] == WorkItemStatus.CANCELLED.value


async def test_ws_reopen_creates_corrective_work_item(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.crew["cap"] = CrewMember(id="cap", name="Captain", role="captain")
    task_id = await _seed_task(hass, 73)
    wi_id = await _create_work_item(hass, 74, task_id)
    await _call_write(
        hass,
        _write("start_work_item"),
        {"id": 75, "type": "boat_management/start_work_item", "work_item_id": wi_id},
    )
    await _call_write(
        hass,
        _write("submit_for_review"),
        {"id": 76, "type": "boat_management/submit_for_review", "work_item_id": wi_id},
    )
    await _call_write(
        hass,
        _write("verify_work_item"),
        {
            "id": 77,
            "type": "boat_management/verify_work_item",
            "work_item_id": wi_id,
            "verified_by": "cap",
        },
    )
    log_count = len(coordinator.data.maintenance_log)
    conn = await _call_write(
        hass,
        _write("reopen_work_item"),
        {"id": 78, "type": "boat_management/reopen_work_item", "work_item_id": wi_id},
    )
    corrective = conn.results[78]
    # Reopen creates a NEW corrective item; the original done item and its
    # immutable log entry are preserved (history is never deleted).
    assert corrective["id"] != wi_id
    assert corrective["id"] in coordinator.data.work_items
    assert corrective["status"] == WorkItemStatus.TODO.value
    assert coordinator.data.work_items[wi_id].status == WorkItemStatus.DONE.value
    assert len(coordinator.data.maintenance_log) == log_count


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
