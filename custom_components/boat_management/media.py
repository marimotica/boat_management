"""Pure media/document domain logic (no Home Assistant imports).

Uploaded photos and PDFs are stored as opaque *blobs* on disk (handled by the
HA-coupled :mod:`media_storage`); this module owns everything that can be
reasoned about without I/O: validating an upload at the edge, building the
immutable-ish document *metadata* record, and the pure mutators that attach a
document to (or detach it from) an equipment/inventory item.

Design notes:

* A document belongs to exactly one target (``target_type``/``target_id``), so
  detaching can safely delete its record and blob without orphaning a shared
  reference.
* The on-disk name is ``<document_id>.<ext>`` and is stored as a portable
  *basename* only -- never an absolute path -- so a vessel snapshot stays valid
  across installs, backups and restores.
* Blobs are addressed by opaque document id, never by filename (the filename is
  display-only metadata), keeping identity stable per AGENTS.md.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .audit import record_audit
from .const import (
    MEDIA_ALLOWED_CONTENT_TYPES,
    MEDIA_CONTENT_TYPE_EXTENSIONS,
    MEDIA_MAX_BYTES,
    MEDIA_TARGET_TYPES,
    MEDIA_URL_PREFIX,
    AuditEventType,
)
from .data import BoatData
from .models import new_id
from .timezone import EventTimestamp
from .validators import ValidationError, require_existing, require_non_empty


def normalize_content_type(content_type: str | None) -> str:
    """Lower-case and strip a content type, dropping any ``; charset=`` suffix."""
    if not content_type:
        return ""
    return content_type.split(";", 1)[0].strip().lower()


def extension_for(content_type: str, filename: str | None = None) -> str:
    """Pick the on-disk extension for a (validated) content type.

    Falls back to the uploaded filename's suffix, then ``bin``, so an unexpected
    type never yields an extensionless blob.
    """
    mapped = MEDIA_CONTENT_TYPE_EXTENSIONS.get(content_type)
    if mapped:
        return mapped
    if filename and "." in filename:
        suffix = filename.rsplit(".", 1)[1].strip().lower()
        if suffix.isalnum():
            return suffix
    return "bin"


def validate_media_upload(
    *,
    filename: str,
    content_type: str,
    size: int,
    allowed_types: frozenset[str] = MEDIA_ALLOWED_CONTENT_TYPES,
    max_bytes: int = MEDIA_MAX_BYTES,
) -> tuple[str, str]:
    """Validate an upload at the edge; return ``(filename, content_type)``.

    Raises :class:`ValidationError` (actionable message) on an empty file, an
    over-size blob, or a content type outside the allow-list. Reusing
    ``ValidationError`` lets the websocket handler surface it the same way as
    every other domain error.
    """
    filename = require_non_empty(filename, "filename")
    normalized = normalize_content_type(content_type)
    if normalized not in allowed_types:
        raise ValidationError(
            f"Unsupported media type '{content_type}'; allowed types are "
            f"{sorted(allowed_types)}"
        )
    if size <= 0:
        raise ValidationError("Uploaded file is empty")
    if size > max_bytes:
        raise ValidationError(
            f"Uploaded file is {size} bytes; the maximum is {max_bytes} bytes"
        )
    return filename, normalized


def build_document_record(
    *,
    filename: str,
    content_type: str,
    size: int,
    sha256: str,
    target_type: str,
    target_id: str,
    timezone_name: str,
    document_id: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build the metadata record for a freshly uploaded blob.

    The caller persists the blob under ``stored_filename`` and the record under
    ``data.documents[id]`` via :func:`attach_media`. ``timezone_name`` is the
    vessel timezone in effect at upload time and is preserved verbatim so the
    local timestamp stays correct after the vessel later changes timezone.
    """
    if target_type not in MEDIA_TARGET_TYPES:
        raise ValidationError(
            f"Cannot attach media to '{target_type}'; expected one of "
            f"{list(MEDIA_TARGET_TYPES)}"
        )
    doc_id = document_id or new_id("doc")
    ext = extension_for(content_type, filename)
    stamp = EventTimestamp.capture(timezone_name, now=now)
    kind = "image" if content_type.startswith("image/") else "document"
    return {
        "id": doc_id,
        "filename": filename,
        # Portable basename only (never an absolute path) so the record survives
        # backup/restore to a different install path.
        "stored_filename": f"{doc_id}.{ext}",
        "content_type": content_type,
        "size": int(size),
        "sha256": sha256,
        "kind": kind,
        "target_type": target_type,
        "target_id": target_id,
        "created_at_utc": stamp.utc.isoformat(),
        "created_at_local": stamp.local_iso,
        "timezone_at_event": stamp.timezone_name,
    }


def _target_collection(data: BoatData, target_type: str) -> dict[str, Any]:
    """Resolve the registry a document attaches to, or raise on a bad type."""
    if target_type == "equipment":
        return data.equipment
    if target_type == "inventory":
        return data.inventory
    raise ValidationError(
        f"Cannot attach media to '{target_type}'; expected one of "
        f"{list(MEDIA_TARGET_TYPES)}"
    )


def attach_media(
    data: BoatData,
    *,
    document: dict[str, Any],
    actor: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Attach a built document record to its target and record an audit event.

    Re-validates the target under the coordinator lock (it may have been retired
    between the pre-flight check and the write), inserts the record, appends the
    opaque id to the target's ``media_refs`` (idempotently), and audits the
    create. Returns the stored record.
    """
    target_type = document["target_type"]
    target_id = document["target_id"]
    collection = _target_collection(data, target_type)
    require_existing(target_id, collection, target_type)

    doc_id = document["id"]
    stored = dict(document)
    data.documents[doc_id] = stored

    target = collection[target_id]
    if doc_id not in target.media_refs:
        target.media_refs.append(doc_id)

    record_audit(
        data.audit_events,
        event_type=AuditEventType.CREATE,
        object_type="document",
        object_id=doc_id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        after=stored,
        reason=f"attached to {target_type} {target_id}",
        now=now,
    )
    return stored


def detach_media(
    data: BoatData,
    *,
    document_id: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Detach and forget a document; return the removed record.

    Removes the id from its target's ``media_refs`` (best effort -- the target
    may already be gone), deletes the metadata record, and audits the delete so
    the document remains resolvable in the audit trail. The websocket layer
    deletes the blob from disk using the returned ``stored_filename``.
    """
    if document_id not in data.documents:
        raise ValidationError(f"Referenced document '{document_id}' does not exist")
    removed = data.documents.pop(document_id)

    target_type = removed.get("target_type")
    target_id = removed.get("target_id")
    collection = None
    if target_type == "equipment":
        collection = data.equipment
    elif target_type == "inventory":
        collection = data.inventory
    if collection is not None and target_id in collection:
        refs = collection[target_id].media_refs
        if document_id in refs:
            refs.remove(document_id)

    record_audit(
        data.audit_events,
        event_type=AuditEventType.DELETE,
        object_type="document",
        object_id=document_id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=removed,
        reason=f"detached from {target_type} {target_id}",
        now=now,
    )
    return removed


def build_media_url(entry_id: str, document_id: str) -> str:
    """Build the authenticated serving URL for a document blob.

    Centralizes the URL shape so the websocket result and the HTTP view never
    drift. The opaque document id is the lookup key; the filename is not in it.
    """
    return f"{MEDIA_URL_PREFIX}/{entry_id}/{document_id}"
