"""HA harness tests for media upload/detach websocket commands and serving view."""

from __future__ import annotations

import base64

from homeassistant.core import HomeAssistant

from custom_components.boat_management import (
    equipment as equipment_ops,
    media_storage,
    websocket_api as ws,
)

_PNG = b"\x89PNG\r\n\x1a\n_fake_png_bytes_for_test_"


class _FakeUser:
    def __init__(self, user_id: str = "test-user") -> None:
        self.id = user_id


class _FakeConnection:
    def __init__(self) -> None:
        self.results: dict[int, object] = {}
        self.errors: dict[int, tuple[str, str]] = {}
        self.messages: list[dict] = []
        self.subscriptions: dict[int, object] = {}
        self.user = _FakeUser()

    def send_result(self, msg_id: int, result: object = None) -> None:
        self.results[msg_id] = result

    def send_error(self, msg_id: int, code: str, message: str) -> None:
        self.errors[msg_id] = (code, message)

    def send_message(self, message: dict) -> None:
        self.messages.append(message)


async def _call_async(hass: HomeAssistant, handler, raw: dict) -> _FakeConnection:
    msg = handler._ws_schema(raw)
    conn = _FakeConnection()
    await handler.__wrapped__(hass, conn, msg)
    return conn


async def _make_equipment(coordinator, name: str = "Port Engine") -> str:
    eq = await coordinator.async_execute(equipment_ops.create_equipment, name=name)
    return eq.id


def _b64(payload: bytes = _PNG) -> str:
    return base64.b64encode(payload).decode("ascii")


def _upload_msg(eq_id: str, *, msg_id: int = 100, **overrides) -> dict:
    base = {
        "id": msg_id,
        "type": "boat_management/upload_media",
        "target_type": "equipment",
        "target_id": eq_id,
        "filename": "engine.png",
        "content_type": "image/png",
        "data": _b64(),
    }
    base.update(overrides)
    return base


# --- upload -----------------------------------------------------------------
async def test_upload_media_attaches_and_writes_blob(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)

    conn = await _call_async(hass, ws.ws_upload_media, _upload_msg(eq_id))
    result = conn.results[100]
    doc = result["document"]

    # Server assigns the opaque id; ref is attached to the equipment item.
    assert doc["id"] in coordinator.data.documents
    assert coordinator.data.equipment[eq_id].media_refs == [doc["id"]]
    assert result["url"] == f"/api/boat_management/media/{entry.entry_id}/{doc['id']}"
    assert doc["content_type"] == "image/png"
    assert doc["sha256"]

    # The blob really hit disk under the per-entry media dir.
    path = media_storage.blob_path(hass, entry.entry_id, doc["stored_filename"])
    assert path.is_file()
    assert path.read_bytes() == _PNG


async def test_upload_media_records_actor(hass: HomeAssistant, setup_vessel) -> None:
    _entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)
    conn = await _call_async(hass, ws.ws_upload_media, _upload_msg(eq_id))
    doc_id = conn.results[100]["document"]["id"]
    actors = {
        e.actor for e in coordinator.data.audit_events.values() if e.object_id == doc_id
    }
    assert actors == {"test-user"}


async def test_upload_media_unknown_target_writes_nothing(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    conn = await _call_async(hass, ws.ws_upload_media, _upload_msg("ghost", msg_id=101))
    assert conn.errors[101][0] == "invalid_request"
    # Fail-fast before any blob/record is created.
    assert coordinator.data.documents == {}


async def test_upload_media_rejects_bad_base64(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)
    conn = await _call_async(
        hass, ws.ws_upload_media, _upload_msg(eq_id, msg_id=102, data="not base64!!")
    )
    assert conn.errors[102][0] == "invalid_request"
    assert coordinator.data.documents == {}


async def test_upload_media_rejects_unsupported_type(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)
    conn = await _call_async(
        hass,
        ws.ws_upload_media,
        _upload_msg(
            eq_id,
            msg_id=103,
            content_type="application/x-msdownload",
            data=_b64(b"MZ junk"),
        ),
    )
    assert conn.errors[103][0] == "invalid_request"
    assert coordinator.data.documents == {}


# --- detach -----------------------------------------------------------------
async def test_detach_media_removes_ref_and_blob(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)
    up = await _call_async(hass, ws.ws_upload_media, _upload_msg(eq_id))
    doc = up.results[100]["document"]
    path = media_storage.blob_path(hass, entry.entry_id, doc["stored_filename"])
    assert path.is_file()

    conn = await _call_async(
        hass,
        ws.ws_detach_media,
        {
            "id": 110,
            "type": "boat_management/detach_media",
            "document_id": doc["id"],
        },
    )
    assert conn.results[110]["detached"] is True
    assert doc["id"] not in coordinator.data.documents
    assert coordinator.data.equipment[eq_id].media_refs == []
    assert not path.exists()


async def test_detach_media_unknown_errors(hass: HomeAssistant, setup_vessel) -> None:
    conn = await _call_async(
        hass,
        ws.ws_detach_media,
        {"id": 111, "type": "boat_management/detach_media", "document_id": "nope"},
    )
    assert conn.errors[111][0] == "invalid_request"


# --- bootstrap exposes documents -------------------------------------------
async def test_bootstrap_includes_documents(hass: HomeAssistant, setup_vessel) -> None:
    _entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)
    up = await _call_async(hass, ws.ws_upload_media, _upload_msg(eq_id))
    doc_id = up.results[100]["document"]["id"]

    msg = ws.ws_bootstrap._ws_schema({"id": 120, "type": "boat_management/bootstrap"})
    conn = _FakeConnection()
    ws.ws_bootstrap(hass, conn, msg)
    payload = conn.results[120]

    assert doc_id in payload["documents"]
    assert payload["counts"]["documents"] == 1


# --- serving view -----------------------------------------------------------
# The view handler is exercised directly (matching the websocket tests' style):
# a real ``hass_client`` would drag in HA's cloud/forwarded HTTP middleware,
# which is unrelated to this integration and flaky in a headless test env. We
# still test the true handler: coordinator resolution, blob read, content type,
# and the 404 paths.
class _FakeRequest:
    def __init__(self, hass: HomeAssistant) -> None:
        self.app = {"hass": hass}


async def _view_get(hass: HomeAssistant, entry_id: str, document_id: str):
    view = media_storage.BoatMediaView()
    return await view.get(_FakeRequest(hass), entry_id, document_id)


async def test_media_view_serves_blob(hass: HomeAssistant, setup_vessel) -> None:
    entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)
    up = await _call_async(hass, ws.ws_upload_media, _upload_msg(eq_id))
    doc_id = up.results[100]["document"]["id"]

    resp = await _view_get(hass, entry.entry_id, doc_id)
    assert resp.status == 200
    assert resp.content_type == "image/png"
    assert resp.body == _PNG


async def test_media_view_unknown_document_is_404(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, _coordinator = setup_vessel
    resp = await _view_get(hass, entry.entry_id, "missing-doc")
    assert resp.status == 404


async def test_media_view_missing_blob_is_404(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, coordinator = setup_vessel
    eq_id = await _make_equipment(coordinator)
    up = await _call_async(hass, ws.ws_upload_media, _upload_msg(eq_id))
    doc = up.results[100]["document"]
    # Metadata present but blob removed underneath: view must 404, not crash.
    media_storage.blob_path(hass, entry.entry_id, doc["stored_filename"]).unlink()
    resp = await _view_get(hass, entry.entry_id, doc["id"])
    assert resp.status == 404


async def test_media_view_unknown_entry_is_404(
    hass: HomeAssistant, setup_vessel
) -> None:
    resp = await _view_get(hass, "nope", "missing-doc")
    assert resp.status == 404
