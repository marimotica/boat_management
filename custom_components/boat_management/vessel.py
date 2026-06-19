"""Vessel domain operations (pure over :class:`BoatData`).

Handles editable vessel attributes. The vessel timezone is always derived from
Home Assistant's configured timezone; it is kept in sync by the coordinator and
is not user-editable through services. Historical log entries preserve the
timezone that was active at the time of completion.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .audit import record_audit
from .const import AuditEventType
from .data import BoatData
from .models import Vessel
from .timezone import utc_now
from .validators import ValidationError


def update_vessel(
    data: BoatData,
    *,
    changes: dict[str, Any],
    actor: str | None = None,
    now: datetime | None = None,
) -> Vessel:
    """Apply display/identity changes to the vessel.

    Identity (``id``) and timezone (``current_timezone``) are not mutable here;
    timezone is managed automatically by the coordinator.
    """
    vessel = data.vessel
    before = vessel.to_dict()

    allowed = {
        "name",
        "vessel_type",
        "callsign",
        "mmsi",
        "home_port",
        "units",
    }
    unknown = set(changes) - allowed
    if unknown:
        raise ValidationError(f"Cannot update vessel field(s): {sorted(unknown)}")

    for key, value in changes.items():
        setattr(vessel, key, value)

    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="vessel",
        object_id=vessel.id,
        timezone_name=vessel.current_timezone,
        actor=actor,
        before=before,
        after=vessel.to_dict(),
        now=now,
    )
    return vessel


def sync_ha_timezone(
    data: BoatData,
    *,
    new_tz: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> Vessel:
    """Sync the vessel's current timezone from Home Assistant's configured timezone.

    Called automatically by the coordinator when HA's timezone changes. Records
    an audit event stamped in the *old* timezone before the change takes effect,
    so the event's local rendering stays correct. Historical log entries are
    never rewritten.
    """
    vessel = data.vessel
    old_tz = vessel.current_timezone
    if old_tz == new_tz:
        return vessel

    before = vessel.to_dict()
    instant = now or utc_now()
    # Stamp the audit event in the old timezone so local rendering is meaningful.
    record_audit(
        data.audit_events,
        event_type=AuditEventType.TIMEZONE_CHANGE,
        object_type="vessel",
        object_id=vessel.id,
        timezone_name=old_tz,
        actor=actor,
        before=before,
        after={**before, "current_timezone": new_tz},
        reason=f"HA timezone changed from {old_tz} to {new_tz}",
        now=instant,
    )

    vessel.current_timezone = new_tz
    return vessel
