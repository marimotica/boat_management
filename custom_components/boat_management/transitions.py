"""Work Item state transition rules (pure).

The transition matrix is the single source of truth for allowed lifecycle
moves. Platform/service code must consult ``can_transition``/``assert_transition``
rather than re-deriving rules with scattered string checks (AGENTS.md).
"""

from __future__ import annotations

from .const import WorkItemStatus

#: Allowed transitions keyed by current status. Mirrors DESIGN.md exactly.
TRANSITIONS: dict[WorkItemStatus, frozenset[WorkItemStatus]] = {
    WorkItemStatus.TODO: frozenset(
        {
            WorkItemStatus.IN_PROGRESS,
            WorkItemStatus.BLOCKED,
            WorkItemStatus.DEFERRED,
            WorkItemStatus.CANCELLED,
        }
    ),
    WorkItemStatus.IN_PROGRESS: frozenset(
        {
            WorkItemStatus.REVIEW,
            WorkItemStatus.BLOCKED,
            WorkItemStatus.DEFERRED,
            WorkItemStatus.CANCELLED,
        }
    ),
    WorkItemStatus.REVIEW: frozenset(
        {
            WorkItemStatus.DONE,
            WorkItemStatus.IN_PROGRESS,
            WorkItemStatus.DEFERRED,
            WorkItemStatus.CANCELLED,
        }
    ),
    WorkItemStatus.BLOCKED: frozenset(
        {WorkItemStatus.TODO, WorkItemStatus.IN_PROGRESS}
    ),
    # A deferred item can be picked back up.
    WorkItemStatus.DEFERRED: frozenset(
        {WorkItemStatus.TODO, WorkItemStatus.IN_PROGRESS}
    ),
    # Terminal states have no outgoing automatic transitions. Reopening a done
    # item is handled explicitly and never deletes history.
    WorkItemStatus.DONE: frozenset(),
    WorkItemStatus.CANCELLED: frozenset(),
}


class TransitionError(ValueError):
    """Raised when a requested Work Item transition is not allowed."""


def _coerce(status: str | WorkItemStatus) -> WorkItemStatus:
    if isinstance(status, WorkItemStatus):
        return status
    try:
        return WorkItemStatus(status)
    except ValueError as err:
        raise TransitionError(f"Unknown work item status: {status!r}") from err


def can_transition(current: str | WorkItemStatus, target: str | WorkItemStatus) -> bool:
    """Return True if ``current -> target`` is permitted."""
    cur = _coerce(current)
    tgt = _coerce(target)
    return tgt in TRANSITIONS.get(cur, frozenset())


def assert_transition(
    current: str | WorkItemStatus, target: str | WorkItemStatus
) -> None:
    """Raise ``TransitionError`` if the transition is not allowed."""
    cur = _coerce(current)
    tgt = _coerce(target)
    if not can_transition(cur, tgt):
        allowed = sorted(s.value for s in TRANSITIONS.get(cur, frozenset()))
        raise TransitionError(
            f"Cannot move work item from '{cur.value}' to '{tgt.value}'. "
            f"Allowed from '{cur.value}': {allowed or ['(none)']}"
        )
