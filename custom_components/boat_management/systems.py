"""Systems registry domain operations (pure over :class:`BoatData`)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .audit import record_audit
from .const import AuditEventType
from .data import BoatData
from .models import System, new_id
from .validators import ValidationError, require_existing, require_non_empty


def create_system(
    data: BoatData,
    *,
    name: str,
    category: str | None = None,
    description: str | None = None,
    parent_system_id: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> System:
    name = require_non_empty(name, "name")
    if parent_system_id is not None:
        require_existing(parent_system_id, data.systems, "system")
    system = System(
        id=new_id("sys"),
        name=name,
        category=category,
        description=description,
        parent_system_id=parent_system_id,
    )
    data.systems[system.id] = system
    record_audit(
        data.audit_events,
        event_type=AuditEventType.CREATE,
        object_type="system",
        object_id=system.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        after=system.to_dict(),
        now=now,
    )
    return system


def update_system(
    data: BoatData,
    *,
    system_id: str,
    changes: dict[str, Any],
    actor: str | None = None,
    now: datetime | None = None,
) -> System:
    require_existing(system_id, data.systems, "system")
    system = data.systems[system_id]
    before = system.to_dict()

    allowed = {"name", "category", "description", "parent_system_id", "active"}
    unknown = set(changes) - allowed
    if unknown:
        raise ValidationError(f"Cannot update system field(s): {sorted(unknown)}")

    if "name" in changes:
        changes = dict(changes)
        changes["name"] = require_non_empty(changes["name"], "name")
    if changes.get("parent_system_id"):
        if changes["parent_system_id"] == system_id:
            raise ValidationError("A system cannot be its own parent")
        require_existing(changes["parent_system_id"], data.systems, "system")

    for key, value in changes.items():
        setattr(system, key, value)

    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="system",
        object_id=system.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=system.to_dict(),
        now=now,
    )
    return system


def archive_system(
    data: BoatData,
    *,
    system_id: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> System:
    """Mark a system inactive. Never hard-deleted, to keep history resolvable."""
    require_existing(system_id, data.systems, "system")
    system = data.systems[system_id]
    before = system.to_dict()
    system.active = False
    record_audit(
        data.audit_events,
        event_type=AuditEventType.ARCHIVE,
        object_type="system",
        object_id=system.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=system.to_dict(),
        now=now,
    )
    return system
