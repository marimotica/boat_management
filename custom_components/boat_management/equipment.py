"""Equipment registry domain operations (pure over :class:`BoatData`).

Equipment is first-class state. It may be retired but is never auto-deleted so
maintenance history stays resolvable. IDs are stable across renames and
relocations.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from .audit import record_audit
from .const import AuditEventType
from .data import BoatData
from .models import Equipment, new_id
from .timezone import utc_now
from .validators import (
    ValidationError,
    require_existing,
    require_non_empty,
    validate_refs,
)

_MUTABLE_FIELDS = {
    "name",
    "system_id",
    "category",
    "manufacturer",
    "model",
    "serial_number",
    "location",
    "installed_date",
    "commissioned_date",
    "documentation_refs",
    "inventory_refs",
    "meter_refs",
    "maintenance_interval_days",
    "active",
}


def create_equipment(
    data: BoatData,
    *,
    name: str,
    system_id: str | None = None,
    inventory_refs: list[str] | None = None,
    actor: str | None = None,
    now: datetime | None = None,
    **fields: Any,
) -> Equipment:
    name = require_non_empty(name, "name")
    if system_id is not None:
        require_existing(system_id, data.systems, "system")
    if inventory_refs:
        validate_refs(inventory_refs, data.inventory, "inventory")

    extra = set(fields) - (_MUTABLE_FIELDS - {"name", "system_id", "inventory_refs"})
    if extra:
        raise ValidationError(f"Unknown equipment field(s): {sorted(extra)}")

    equipment = Equipment(
        id=new_id("eq"),
        name=name,
        system_id=system_id,
        inventory_refs=list(inventory_refs or []),
        **fields,
    )
    data.equipment[equipment.id] = equipment
    record_audit(
        data.audit_events,
        event_type=AuditEventType.CREATE,
        object_type="equipment",
        object_id=equipment.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        after=equipment.to_dict(),
        now=now,
    )
    return equipment


def update_equipment(
    data: BoatData,
    *,
    equipment_id: str,
    changes: dict[str, Any],
    actor: str | None = None,
    now: datetime | None = None,
) -> Equipment:
    require_existing(equipment_id, data.equipment, "equipment")
    equipment = data.equipment[equipment_id]
    before = equipment.to_dict()

    unknown = set(changes) - _MUTABLE_FIELDS
    if unknown:
        raise ValidationError(f"Cannot update equipment field(s): {sorted(unknown)}")

    changes = dict(changes)
    if "name" in changes:
        changes["name"] = require_non_empty(changes["name"], "name")
    if changes.get("system_id"):
        require_existing(changes["system_id"], data.systems, "system")
    if "inventory_refs" in changes and changes["inventory_refs"]:
        validate_refs(changes["inventory_refs"], data.inventory, "inventory")

    for key, value in changes.items():
        setattr(equipment, key, value)

    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="equipment",
        object_id=equipment.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=equipment.to_dict(),
        now=now,
    )
    return equipment


def retire_equipment(
    data: BoatData,
    *,
    equipment_id: str,
    retired_date: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> Equipment:
    """Retire equipment (soft). History referencing it remains resolvable."""
    require_existing(equipment_id, data.equipment, "equipment")
    equipment = data.equipment[equipment_id]
    before = equipment.to_dict()
    equipment.active = False
    equipment.retired_date = retired_date or utc_now().date().isoformat()
    record_audit(
        data.audit_events,
        event_type=AuditEventType.RETIRE,
        object_type="equipment",
        object_id=equipment.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=equipment.to_dict(),
        now=now,
    )
    return equipment


# ---------------------------------------------------------------------------
# Maintenance scheduling projection (pure)
# ---------------------------------------------------------------------------
def _parse_baseline(date_str: str | None) -> datetime | None:
    """Parse an ISO date/datetime string into a UTC-aware datetime, or None."""
    if not date_str:
        return None
    try:
        parsed = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def last_maintenance_utc(data: BoatData, equipment_id: str) -> datetime | None:
    """Return the latest verified maintenance completion for an equipment item."""
    latest: datetime | None = None
    for entry in data.maintenance_log.values():
        if equipment_id not in entry.equipment_refs:
            continue
        if latest is None or entry.completed_at_utc > latest:
            latest = entry.completed_at_utc
    return latest


def equipment_due_for_maintenance(
    data: BoatData,
    *,
    now: datetime | None = None,
    within_days: int = 0,
) -> list[str]:
    """Return ids of active equipment whose scheduled maintenance is due.

    An item is considered due when it has a ``maintenance_interval_days``
    schedule and its next-due instant (last verified maintenance, else
    commissioned/installed date, plus the interval) falls on or before
    ``now + within_days``. Items with a schedule but no resolvable baseline are
    surfaced as due so a missing baseline is noisy rather than silently hidden.
    """
    moment = now or utc_now()
    horizon = moment + timedelta(days=within_days)
    due: list[str] = []
    for eq in data.equipment.values():
        if not eq.active or not eq.maintenance_interval_days:
            continue
        baseline = (
            last_maintenance_utc(data, eq.id)
            or _parse_baseline(eq.commissioned_date)
            or _parse_baseline(eq.installed_date)
        )
        if baseline is None:
            due.append(eq.id)
            continue
        if baseline + timedelta(days=eq.maintenance_interval_days) <= horizon:
            due.append(eq.id)
    return sorted(due)
