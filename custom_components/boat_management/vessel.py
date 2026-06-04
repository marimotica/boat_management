"""Vessel domain operations (pure over :class:`BoatData`).

Handles editable vessel attributes and the timezone-change workflow. The
vessel timezone is operational state: changing it never rewrites historical
local timestamps, it only affects new events (DESIGN.md timezone policy).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .audit import record_audit
from .const import AuditEventType, TimezoneSource
from .data import BoatData
from .models import Vessel
from .timezone import utc_now, validate_timezone
from .validators import ValidationError


def update_vessel(
    data: BoatData,
    *,
    changes: dict[str, Any],
    actor: str | None = None,
    now: datetime | None = None,
) -> Vessel:
    """Apply display/identity changes to the vessel.

    Identity (``id``) is never mutable. Timezone fields go through
    :func:`set_vessel_timezone` so the source/stamp are recorded correctly.
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
        "default_timezone",
    }
    unknown = set(changes) - allowed
    if unknown:
        raise ValidationError(f"Cannot update vessel field(s): {sorted(unknown)}")

    if "default_timezone" in changes:
        changes = dict(changes)
        changes["default_timezone"] = validate_timezone(changes["default_timezone"])

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


def set_vessel_timezone(
    data: BoatData,
    *,
    timezone_name: str,
    source: str = TimezoneSource.MANUAL.value,
    actor: str | None = None,
    now: datetime | None = None,
) -> Vessel:
    """Change the active vessel timezone, recording source and instant.

    Historical events keep their own ``timezone_at_event``; only future events
    use the new ``current_timezone``.
    """
    vessel = data.vessel
    before = vessel.to_dict()
    new_tz = validate_timezone(timezone_name)

    valid_sources = {s.value for s in TimezoneSource}
    if source not in valid_sources:
        raise ValidationError(
            f"Invalid timezone source '{source}'; expected one of "
            f"{sorted(valid_sources)}"
        )

    instant = now or utc_now()
    # Record audit in the timezone in effect *before* the change so the local
    # rendering of the change event reflects where the vessel actually was.
    record_audit(
        data.audit_events,
        event_type=AuditEventType.TIMEZONE_CHANGE,
        object_type="vessel",
        object_id=vessel.id,
        timezone_name=vessel.current_timezone,
        actor=actor,
        before=before,
        after={**before, "current_timezone": new_tz, "timezone_source": source},
        reason=f"Vessel timezone set to {new_tz}",
        now=instant,
    )

    vessel.current_timezone = new_tz
    vessel.timezone_source = source
    vessel.timezone_updated_at_utc = instant
    return vessel
