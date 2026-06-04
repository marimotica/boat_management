"""Pure search/filter helpers for read-only projections (no Home Assistant).

Used by the websocket list command so a future panel can do server-side
filtering without pulling whole collections. Kept pure so the matching rules
are directly unit-testable.
"""

from __future__ import annotations

from typing import Any


def _contains(value: Any, needle: str) -> bool:
    """Recursively test whether ``needle`` appears in a serialized value."""
    if isinstance(value, dict):
        return any(_contains(v, needle) for v in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains(v, needle) for v in value)
    if value is None:
        return False
    return needle in str(value).lower()


def filter_serialized(
    items: dict[str, dict[str, Any]],
    *,
    query: str | None = None,
    limit: int | None = None,
) -> dict[str, dict[str, Any]]:
    """Filter serialized records by substring ``query`` and cap by ``limit``.

    Insertion order is preserved. ``query`` matches case-insensitively when the
    substring appears in any (possibly nested) value of a record. ``limit``
    keeps at most that many matching records; a non-positive limit yields none.
    """
    if limit is not None and limit <= 0:
        return {}
    needle = query.strip().lower() if query else None
    result: dict[str, dict[str, Any]] = {}
    for key, record in items.items():
        if needle and not _contains(record, needle):
            continue
        result[key] = record
        if limit is not None and len(result) >= limit:
            break
    return result
