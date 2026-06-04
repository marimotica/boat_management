"""Task Catalogue domain operations (pure over :class:`BoatData`).

The catalogue is the finite, owner-controlled source of reusable task
definitions. Items can be archived but are not hard-deleted when referenced by
history (AGENTS.md task catalogue rules).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .audit import record_audit
from .const import AuditEventType
from .data import BoatData
from .models import TaskCatalogueItem, TriggerRule, new_id
from .validators import (
    ValidationError,
    require_existing,
    require_non_empty,
    validate_refs,
    validate_trigger_rule_source,
)

_MUTABLE_FIELDS = {
    "title",
    "description",
    "system_refs",
    "equipment_refs",
    "inventory_refs",
    "required_skills",
    "estimated_duration_minutes",
    "procedure",
    "safety_notes",
    "default_verifier",
    "trigger_rules",
    "active",
}


def _build_trigger_rules(raw: list[Any] | None) -> list[TriggerRule]:
    rules: list[TriggerRule] = []
    for entry in raw or []:
        if isinstance(entry, TriggerRule):
            rule = entry
        elif isinstance(entry, dict):
            if "source" not in entry:
                raise ValidationError("Trigger rule requires a 'source'")
            rule = TriggerRule.from_dict(entry)
        else:
            raise ValidationError(f"Invalid trigger rule: {entry!r}")
        validate_trigger_rule_source(rule.source)
        rules.append(rule)
    return rules


def _validate_catalogue_refs(data: BoatData, fields: dict[str, Any]) -> None:
    if fields.get("system_refs"):
        validate_refs(fields["system_refs"], data.systems, "system")
    if fields.get("equipment_refs"):
        validate_refs(fields["equipment_refs"], data.equipment, "equipment")
    if fields.get("inventory_refs"):
        validate_refs(fields["inventory_refs"], data.inventory, "inventory")


def create_catalogue_task(
    data: BoatData,
    *,
    title: str,
    trigger_rules: list[Any] | None = None,
    actor: str | None = None,
    now: datetime | None = None,
    **fields: Any,
) -> TaskCatalogueItem:
    title = require_non_empty(title, "title")
    unknown = set(fields) - (_MUTABLE_FIELDS - {"title", "trigger_rules"})
    if unknown:
        raise ValidationError(f"Unknown catalogue field(s): {sorted(unknown)}")
    _validate_catalogue_refs(data, fields)
    rules = _build_trigger_rules(trigger_rules)

    task = TaskCatalogueItem(
        id=new_id("task"),
        title=title,
        trigger_rules=rules,
        **fields,
    )
    data.task_catalogue[task.id] = task
    record_audit(
        data.audit_events,
        event_type=AuditEventType.CREATE,
        object_type="task_catalogue",
        object_id=task.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        after=task.to_dict(),
        now=now,
    )
    return task


def update_catalogue_task(
    data: BoatData,
    *,
    catalogue_task_id: str,
    changes: dict[str, Any],
    actor: str | None = None,
    now: datetime | None = None,
) -> TaskCatalogueItem:
    require_existing(catalogue_task_id, data.task_catalogue, "catalogue task")
    task = data.task_catalogue[catalogue_task_id]
    before = task.to_dict()

    unknown = set(changes) - _MUTABLE_FIELDS
    if unknown:
        raise ValidationError(f"Cannot update catalogue field(s): {sorted(unknown)}")

    changes = dict(changes)
    if "title" in changes:
        changes["title"] = require_non_empty(changes["title"], "title")
    _validate_catalogue_refs(data, changes)
    if "trigger_rules" in changes:
        changes["trigger_rules"] = _build_trigger_rules(changes["trigger_rules"])

    for key, value in changes.items():
        setattr(task, key, value)

    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="task_catalogue",
        object_id=task.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=task.to_dict(),
        now=now,
    )
    return task


def archive_catalogue_task(
    data: BoatData,
    *,
    catalogue_task_id: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> TaskCatalogueItem:
    """Archive (deactivate) a catalogue task. Never hard-deleted."""
    require_existing(catalogue_task_id, data.task_catalogue, "catalogue task")
    task = data.task_catalogue[catalogue_task_id]
    before = task.to_dict()
    task.active = False
    record_audit(
        data.audit_events,
        event_type=AuditEventType.ARCHIVE,
        object_type="task_catalogue",
        object_id=task.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=task.to_dict(),
        now=now,
    )
    return task
