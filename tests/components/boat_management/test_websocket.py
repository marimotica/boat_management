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


class _FakeConnection:
    def __init__(self) -> None:
        self.results: dict[int, object] = {}
        self.errors: dict[int, tuple[str, str]] = {}

    def send_result(self, msg_id: int, result: object) -> None:
        self.results[msg_id] = result

    def send_error(self, msg_id: int, code: str, message: str) -> None:
        self.errors[msg_id] = (code, message)


def _call(hass: HomeAssistant, handler, raw: dict) -> _FakeConnection:
    msg = handler._ws_schema(raw)
    conn = _FakeConnection()
    handler(hass, conn, msg)
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
