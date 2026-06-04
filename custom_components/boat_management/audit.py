"""Audit event construction (pure).

Every meaningful mutation must be auditable (AGENTS.md non-negotiables). This
module builds :class:`AuditEvent` objects with correct UTC + vessel-local
timestamps. It has no Home Assistant dependency so it is directly testable.

Audit events capture a redactable ``before``/``after`` snapshot. Callers are
responsible for passing already-serialized dicts (``model.to_dict()``) so the
stored audit trail does not hold live object references.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .const import AuditEventType
from .models import AuditEvent, new_id
from .timezone import EventTimestamp


def build_audit_event(
    *,
    event_type: AuditEventType | str,
    object_type: str,
    object_id: str,
    timezone_name: str,
    actor: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    now: datetime | None = None,
) -> AuditEvent:
    """Construct an :class:`AuditEvent` stamped in vessel-local time.

    ``timezone_name`` is the vessel timezone in effect at the moment of the
    event; it is preserved verbatim so the local rendering remains correct even
    after the vessel later changes timezone.
    """
    stamp = EventTimestamp.capture(timezone_name, now=now)
    event_value = (
        event_type.value if isinstance(event_type, AuditEventType) else str(event_type)
    )
    return AuditEvent(
        id=new_id("audit"),
        event_type=event_value,
        object_type=object_type,
        object_id=object_id,
        timestamp_utc=stamp.utc,
        timestamp_local=stamp.local_iso,
        timezone_at_event=stamp.timezone_name,
        actor=actor,
        before=before,
        after=after,
        reason=reason,
    )


def record_audit(
    audit_events: dict[str, AuditEvent],
    *,
    event_type: AuditEventType | str,
    object_type: str,
    object_id: str,
    timezone_name: str,
    actor: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    now: datetime | None = None,
) -> AuditEvent:
    """Build an audit event and append it to ``audit_events`` in one step."""
    event = build_audit_event(
        event_type=event_type,
        object_type=object_type,
        object_id=object_id,
        timezone_name=timezone_name,
        actor=actor,
        before=before,
        after=after,
        reason=reason,
        now=now,
    )
    audit_events[event.id] = event
    return event
