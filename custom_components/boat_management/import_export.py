"""Import/export of integration data (pure).

Export produces a versioned, self-describing envelope that preserves stable IDs
and full history. Import validates an envelope *before* any live state is
mutated, supports dry-run, and reports conflicts clearly (INSTRUCTIONS.md).

To remain Home Assistant-free and directly testable, these functions operate on
plain serialized payloads (the same shape as ``BoatData.to_dict()``), not on
the live typed container.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .const import ALL_COLLECTIONS, EXPORT_SCHEMA_VERSION, STORAGE_VERSION
from .timezone import utc_now

#: Collections that hold immutable history and must not be silently overwritten.
_IMMUTABLE_COLLECTIONS = frozenset({"maintenance_log"})

IMPORT_MODE_MERGE = "merge"
IMPORT_MODE_REPLACE = "replace"
_VALID_MODES = frozenset({IMPORT_MODE_MERGE, IMPORT_MODE_REPLACE})


class ImportError_(ValueError):
    """Raised when an import payload is structurally invalid."""


def export_payload(
    storage_dict: dict[str, Any],
    *,
    include_logbook: bool = True,
) -> dict[str, Any]:
    """Build a versioned export envelope from a storage payload.

    ``storage_dict`` is the output of ``BoatData.to_dict()``. IDs are preserved
    verbatim. When ``include_logbook`` is False the immutable maintenance log is
    omitted (used by data-only exports); ``export_logbook`` style callers keep
    it.
    """
    collections = {name: dict(storage_dict.get(name) or {}) for name in ALL_COLLECTIONS}
    if not include_logbook:
        collections["maintenance_log"] = {}

    return {
        "export_schema_version": EXPORT_SCHEMA_VERSION,
        "storage_version": int(storage_dict.get("version", STORAGE_VERSION)),
        "exported_at_utc": utc_now().isoformat(),
        "vessel": storage_dict.get("vessel"),
        "collections": collections,
    }


def export_logbook_payload(storage_dict: dict[str, Any]) -> dict[str, Any]:
    """Export only the immutable maintenance logbook and vessel identity."""
    return {
        "export_schema_version": EXPORT_SCHEMA_VERSION,
        "storage_version": int(storage_dict.get("version", STORAGE_VERSION)),
        "exported_at_utc": utc_now().isoformat(),
        "vessel": storage_dict.get("vessel"),
        "maintenance_log": dict(storage_dict.get("maintenance_log") or {}),
    }


@dataclass(slots=True)
class ImportReport:
    """Summary of an import evaluation (works for dry-run and real runs)."""

    mode: str
    dry_run: bool
    added: dict[str, list[str]] = field(default_factory=dict)
    updated: dict[str, list[str]] = field(default_factory=dict)
    skipped: dict[str, list[str]] = field(default_factory=dict)
    conflicts: list[str] = field(default_factory=list)

    @property
    def added_count(self) -> int:
        return sum(len(v) for v in self.added.values())

    @property
    def updated_count(self) -> int:
        return sum(len(v) for v in self.updated.values())

    @property
    def skipped_count(self) -> int:
        return sum(len(v) for v in self.skipped.values())

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "dry_run": self.dry_run,
            "added": self.added,
            "updated": self.updated,
            "skipped": self.skipped,
            "conflicts": self.conflicts,
            "added_count": self.added_count,
            "updated_count": self.updated_count,
            "skipped_count": self.skipped_count,
        }


def _validate_envelope(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate the import envelope structure and return its collections."""
    if not isinstance(payload, dict):
        raise ImportError_("Import payload must be an object")
    version = payload.get("export_schema_version")
    if version is None:
        raise ImportError_("Import payload missing 'export_schema_version'")
    if int(version) > EXPORT_SCHEMA_VERSION:
        raise ImportError_(
            f"Import schema version {version} is newer than supported "
            f"{EXPORT_SCHEMA_VERSION}"
        )
    collections = payload.get("collections")
    if not isinstance(collections, dict):
        raise ImportError_("Import payload missing 'collections' object")
    for name, value in collections.items():
        if name not in ALL_COLLECTIONS:
            raise ImportError_(f"Unknown import collection '{name}'")
        if not isinstance(value, dict):
            raise ImportError_(f"Import collection '{name}' must be an object")
    return collections


def apply_import(
    current: dict[str, Any],
    payload: dict[str, Any],
    *,
    mode: str = IMPORT_MODE_MERGE,
    dry_run: bool = False,
) -> tuple[dict[str, Any], ImportReport]:
    """Apply an import envelope to a copy of ``current`` storage payload.

    Returns the resulting storage dict and an :class:`ImportReport`. In merge
    mode, existing immutable log entries are never overwritten (conflicts are
    reported and skipped). In replace mode, non-history collections are
    replaced wholesale but the logbook is still merged additively to protect
    history.

    Validation happens before mutation; on ``dry_run`` the returned storage
    dict equals ``current`` unchanged.
    """
    if mode not in _VALID_MODES:
        raise ImportError_(
            f"Invalid import mode '{mode}'; expected one of {sorted(_VALID_MODES)}"
        )
    incoming = _validate_envelope(payload)

    import copy

    result = copy.deepcopy(current)
    report = ImportReport(mode=mode, dry_run=dry_run)

    for name in ALL_COLLECTIONS:
        existing = dict(result.get(name) or {})
        new_items = dict(incoming.get(name) or {})
        added: list[str] = []
        updated: list[str] = []
        skipped: list[str] = []

        immutable = name in _IMMUTABLE_COLLECTIONS

        if mode == IMPORT_MODE_REPLACE and not immutable:
            # Replace wholesale, but report what changed.
            for item_id in new_items:
                if item_id in existing:
                    updated.append(item_id)
                else:
                    added.append(item_id)
            merged = new_items
        else:
            merged = existing
            for item_id, item in new_items.items():
                if item_id in existing:
                    if immutable:
                        # Never overwrite immutable history.
                        skipped.append(item_id)
                        report.conflicts.append(
                            f"{name}:{item_id} already exists and is immutable"
                        )
                        continue
                    merged[item_id] = item
                    updated.append(item_id)
                else:
                    merged[item_id] = item
                    added.append(item_id)

        if added:
            report.added[name] = sorted(added)
        if updated:
            report.updated[name] = sorted(updated)
        if skipped:
            report.skipped[name] = sorted(skipped)

        if not dry_run:
            result[name] = merged

    # Optionally import vessel identity if provided (never on dry-run).
    if not dry_run and payload.get("vessel"):
        result["vessel"] = payload["vessel"]

    return result, report
