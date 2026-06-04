"""Deterministic storage migrations for boat_management.

Migrations transform a raw persisted payload from any supported older schema
version up to :data:`STORAGE_VERSION`. They are pure functions over plain
dicts so they can be unit-tested without Home Assistant, and they MUST be
deterministic and non-destructive: unknown future-safe fields are preserved,
history is never silently dropped.

A migration step is a callable ``(raw: dict) -> dict`` registered against the
version it upgrades *from*. ``migrate_to_latest`` applies steps in order and
reports whether anything changed so callers can log/record the source version.
"""

from __future__ import annotations

from collections.abc import Callable
import copy
from typing import Any

from .const import ALL_COLLECTIONS, STORAGE_VERSION


class MigrationError(Exception):
    """Raised when a stored payload cannot be safely migrated.

    The caller is expected to surface this as a repair issue and avoid partial
    writes (see AGENTS.md storage rules).
    """


def _ensure_collections(raw: dict[str, Any]) -> dict[str, Any]:
    """Guarantee every known collection key exists as a dict.

    Older payloads may predate a collection; we add it empty rather than let
    downstream code ``KeyError``. This is additive and non-destructive.
    """
    for name in ALL_COLLECTIONS:
        existing = raw.get(name)
        if existing is None:
            raw[name] = {}
        elif not isinstance(existing, dict):
            raise MigrationError(
                f"Storage collection '{name}' must be an object, got "
                f"{type(existing).__name__}"
            )
    return raw


# ---------------------------------------------------------------------------
# Migration steps keyed by the version they upgrade FROM.
# ---------------------------------------------------------------------------
# Currently the only schema is version 1, so there are no historical steps yet.
# When STORAGE_VERSION is bumped, add an entry here, e.g.::
#
#     def _migrate_1_to_2(raw: dict[str, Any]) -> dict[str, Any]:
#         ...
#         return raw
#
#     _MIGRATIONS[1] = _migrate_1_to_2
#
_MIGRATIONS: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {}


def migrate_to_latest(raw: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Migrate ``raw`` up to the latest schema version.

    Returns a ``(payload, changed)`` tuple. ``changed`` is True when either the
    schema version advanced or normalization mutated the payload. The input is
    deep-copied so the caller's object is never mutated in place.
    """
    working = copy.deepcopy(raw)
    original_snapshot = copy.deepcopy(working)

    version = int(working.get("version", 1))
    if version > STORAGE_VERSION:
        raise MigrationError(
            f"Stored schema version {version} is newer than supported version "
            f"{STORAGE_VERSION}; refusing to downgrade and risk data loss"
        )

    while version < STORAGE_VERSION:
        step = _MIGRATIONS.get(version)
        if step is None:
            raise MigrationError(
                f"No migration registered from schema version {version} to "
                f"{version + 1}"
            )
        working = step(working)
        version += 1
        working["version"] = version

    working["version"] = STORAGE_VERSION
    working = _ensure_collections(working)

    changed = working != original_snapshot
    return working, changed
