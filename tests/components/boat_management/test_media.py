"""Pure unit tests for media document logic (no Home Assistant needed)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from custom_components.boat_management.const import (
    ISSUE_MISSING_DOCUMENT_REF,
    AuditEventType,
)
from custom_components.boat_management.media import (
    attach_media,
    build_document_record,
    build_media_url,
    detach_media,
    extension_for,
    normalize_content_type,
    validate_media_upload,
)
from custom_components.boat_management.models import Equipment, InventoryItem
from custom_components.boat_management.validators import (
    ValidationError,
    check_media_references,
)

from .helpers import make_data

_NOW = datetime(2024, 1, 15, 12, 0, tzinfo=UTC)


def _record(target_type: str, target_id: str, *, doc_id: str = "doc_test") -> dict:
    return build_document_record(
        filename="photo.jpg",
        content_type="image/jpeg",
        size=2048,
        sha256="a" * 64,
        target_type=target_type,
        target_id=target_id,
        timezone_name="Europe/Paris",
        document_id=doc_id,
        now=_NOW,
    )


# --- validate_media_upload --------------------------------------------------
def test_validate_upload_accepts_image() -> None:
    filename, content_type = validate_media_upload(
        filename="  photo.JPG  ", content_type="image/jpeg; charset=binary", size=10
    )
    assert filename == "photo.JPG"
    # Normalized: lower-cased, charset suffix stripped.
    assert content_type == "image/jpeg"


def test_validate_upload_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError, match="Unsupported media type"):
        validate_media_upload(
            filename="evil.exe", content_type="application/x-msdownload", size=10
        )


def test_validate_upload_rejects_empty() -> None:
    with pytest.raises(ValidationError, match="empty"):
        validate_media_upload(filename="a.png", content_type="image/png", size=0)


def test_validate_upload_rejects_oversize() -> None:
    with pytest.raises(ValidationError, match="maximum"):
        validate_media_upload(
            filename="a.png", content_type="image/png", size=10, max_bytes=5
        )


def test_validate_upload_rejects_blank_filename() -> None:
    with pytest.raises(ValidationError, match="filename"):
        validate_media_upload(filename="   ", content_type="image/png", size=10)


# --- helpers ----------------------------------------------------------------
def test_normalize_content_type() -> None:
    assert normalize_content_type("IMAGE/PNG; charset=x") == "image/png"
    assert normalize_content_type(None) == ""


def test_extension_for_maps_known_types() -> None:
    assert extension_for("image/jpeg") == "jpg"
    assert extension_for("application/pdf") == "pdf"


def test_extension_for_falls_back_to_filename_then_bin() -> None:
    assert extension_for("application/unknown", "scan.tiff") == "tiff"
    assert extension_for("application/unknown", "noext") == "bin"


def test_build_media_url_uses_opaque_id() -> None:
    url = build_media_url("entry123", "doc_abc")
    assert url == "/api/boat_management/media/entry123/doc_abc"
    # Filename is never part of the URL.
    assert "photo" not in url


# --- build_document_record --------------------------------------------------
def test_build_record_preserves_local_timezone_context() -> None:
    record = _record("equipment", "eq1")
    assert record["id"] == "doc_test"
    assert record["stored_filename"] == "doc_test.jpg"
    assert record["kind"] == "image"
    assert record["size"] == 2048
    assert record["sha256"] == "a" * 64
    assert record["target_type"] == "equipment"
    assert record["target_id"] == "eq1"
    assert record["timezone_at_event"] == "Europe/Paris"
    # Paris is UTC+1 in January; the captured local instant preserves that.
    assert record["created_at_local"].endswith("+01:00")
    assert record["created_at_utc"] == "2024-01-15T12:00:00+00:00"


def test_build_record_pdf_is_document_kind() -> None:
    record = build_document_record(
        filename="manual.pdf",
        content_type="application/pdf",
        size=100,
        sha256="b" * 64,
        target_type="inventory",
        target_id="inv1",
        timezone_name="UTC",
    )
    assert record["kind"] == "document"
    assert record["stored_filename"].endswith(".pdf")


def test_build_record_rejects_bad_target_type() -> None:
    with pytest.raises(ValidationError, match="Cannot attach media"):
        build_document_record(
            filename="a.png",
            content_type="image/png",
            size=1,
            sha256="c" * 64,
            target_type="vessel",
            target_id="x",
            timezone_name="UTC",
        )


# --- attach_media -----------------------------------------------------------
def test_attach_media_links_record_to_equipment_and_audits() -> None:
    data = make_data()
    data.equipment["eq1"] = Equipment(id="eq1", name="Port Engine")
    record = _record("equipment", "eq1")

    stored = attach_media(data, document=record, actor="skipper", now=_NOW)

    assert stored["id"] == "doc_test"
    assert "doc_test" in data.documents
    assert data.equipment["eq1"].media_refs == ["doc_test"]
    events = [e for e in data.audit_events.values() if e.object_id == "doc_test"]
    assert len(events) == 1
    assert events[0].event_type == AuditEventType.CREATE.value
    assert events[0].object_type == "document"
    assert events[0].actor == "skipper"


def test_attach_media_to_inventory() -> None:
    data = make_data()
    data.inventory["inv1"] = InventoryItem(id="inv1", name="Impeller")
    attach_media(data, document=_record("inventory", "inv1"), now=_NOW)
    assert data.inventory["inv1"].media_refs == ["doc_test"]


def test_attach_media_is_idempotent_on_ref() -> None:
    data = make_data()
    data.equipment["eq1"] = Equipment(id="eq1", name="Port Engine")
    record = _record("equipment", "eq1")
    attach_media(data, document=record, now=_NOW)
    attach_media(data, document=record, now=_NOW)
    # The opaque id appears once even if attached twice.
    assert data.equipment["eq1"].media_refs == ["doc_test"]


def test_attach_media_rejects_unknown_target() -> None:
    data = make_data()
    with pytest.raises(ValidationError, match="does not exist"):
        attach_media(data, document=_record("equipment", "ghost"), now=_NOW)


# --- detach_media -----------------------------------------------------------
def test_detach_media_removes_ref_record_and_audits() -> None:
    data = make_data()
    data.equipment["eq1"] = Equipment(id="eq1", name="Port Engine")
    attach_media(data, document=_record("equipment", "eq1"), now=_NOW)

    removed = detach_media(data, document_id="doc_test", actor="mate", now=_NOW)

    assert removed["stored_filename"] == "doc_test.jpg"
    assert "doc_test" not in data.documents
    assert data.equipment["eq1"].media_refs == []
    deletes = [
        e
        for e in data.audit_events.values()
        if e.object_id == "doc_test" and e.event_type == AuditEventType.DELETE.value
    ]
    assert len(deletes) == 1
    assert deletes[0].actor == "mate"


def test_detach_media_tolerates_missing_target() -> None:
    data = make_data()
    data.equipment["eq1"] = Equipment(id="eq1", name="Port Engine")
    attach_media(data, document=_record("equipment", "eq1"), now=_NOW)
    # Target removed out from under the document; detach must still succeed.
    del data.equipment["eq1"]
    removed = detach_media(data, document_id="doc_test", now=_NOW)
    assert removed["id"] == "doc_test"
    assert "doc_test" not in data.documents


def test_detach_media_rejects_unknown_document() -> None:
    data = make_data()
    with pytest.raises(ValidationError, match="does not exist"):
        detach_media(data, document_id="nope", now=_NOW)


# --- model media_refs roundtrip --------------------------------------------
def test_equipment_media_refs_roundtrip_and_backfill() -> None:
    eq = Equipment(id="eq1", name="Pump", media_refs=["doc1", "doc2"])
    assert Equipment.from_dict(eq.to_dict()).media_refs == ["doc1", "doc2"]
    # Legacy payloads without the field load as an empty list (backward-safe).
    legacy = {"id": "eq2", "name": "Old"}
    assert Equipment.from_dict(legacy).media_refs == []


def test_inventory_media_refs_roundtrip_and_backfill() -> None:
    item = InventoryItem(id="inv1", name="Belt", media_refs=["doc9"])
    assert InventoryItem.from_dict(item.to_dict()).media_refs == ["doc9"]
    legacy = {"id": "inv2", "name": "Old"}
    assert InventoryItem.from_dict(legacy).media_refs == []


# --- reference integrity ----------------------------------------------------
def test_check_media_references_flags_dangling() -> None:
    data = make_data()
    data.equipment["eq1"] = Equipment(id="eq1", name="Pump", media_refs=["ghost"])
    data.inventory["inv1"] = InventoryItem(id="inv1", name="Belt", media_refs=["d1"])
    data.documents["d1"] = {"id": "d1"}

    problems = check_media_references(data.equipment, data.inventory, data.documents)

    assert len(problems) == 1
    assert problems[0].issue_type == ISSUE_MISSING_DOCUMENT_REF
    assert problems[0].object_id == "eq1"
    assert problems[0].missing_ref == "ghost"
