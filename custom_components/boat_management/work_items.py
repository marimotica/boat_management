"""Work Item lifecycle domain operations (pure over :class:`BoatData`).

Work Items are instantiated from catalogue tasks. All status changes go through
the :mod:`transitions` matrix so lifecycle rules live in exactly one place. The
``review -> done`` verification transition is special (it creates an immutable
log entry) and lives in :mod:`logbook`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .audit import record_audit
from .const import AuditEventType, TriggerSource, WorkItemStatus
from .data import BoatData
from .models import InventoryUsage, WorkItem, new_id
from .timezone import utc_now
from .transitions import assert_transition
from .validators import (
    ValidationError,
    require_existing,
    validate_refs,
)


def _record_transition(
    data: BoatData,
    work_item: WorkItem,
    before: dict[str, Any],
    *,
    actor: str | None,
    reason: str | None,
    now: datetime | None,
) -> None:
    record_audit(
        data.audit_events,
        event_type=AuditEventType.TRANSITION,
        object_type="work_item",
        object_id=work_item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=work_item.to_dict(),
        reason=reason,
        now=now,
    )


def create_work_item(
    data: BoatData,
    *,
    catalogue_task_id: str,
    trigger_source: str = TriggerSource.MANUAL.value,
    trigger_key: str | None = None,
    operational_context_id: str | None = None,
    title: str | None = None,
    assigned_to: str | None = None,
    due_date: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    """Instantiate a work item from a known catalogue task.

    A catalogue task is required: operational events instantiate known tasks;
    they do not invent arbitrary work (AGENTS.md).
    """
    require_existing(catalogue_task_id, data.task_catalogue, "catalogue task")
    if assigned_to is not None:
        require_existing(assigned_to, data.crew, "crew member")

    instant = now or utc_now()
    task = data.task_catalogue[catalogue_task_id]
    work_item = WorkItem(
        id=new_id("work"),
        catalogue_task_id=catalogue_task_id,
        status=WorkItemStatus.TODO.value,
        trigger_source=trigger_source,
        trigger_key=trigger_key,
        operational_context_id=operational_context_id,
        title=title or task.title,
        assigned_to=assigned_to,
        due_date=due_date,
        created_at_utc=instant,
        timezone_at_creation=data.vessel.current_timezone,
    )
    data.work_items[work_item.id] = work_item
    record_audit(
        data.audit_events,
        event_type=AuditEventType.CREATE,
        object_type="work_item",
        object_id=work_item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        after=work_item.to_dict(),
        now=instant,
    )
    return work_item


def _get_work_item(data: BoatData, work_item_id: str) -> WorkItem:
    require_existing(work_item_id, data.work_items, "work item")
    return data.work_items[work_item_id]


def claim_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    crew_id: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    """Assign available work to a crew member without changing status."""
    work_item = _get_work_item(data, work_item_id)
    require_existing(crew_id, data.crew, "crew member")
    if WorkItemStatus(work_item.status) not in {
        WorkItemStatus.TODO,
        WorkItemStatus.IN_PROGRESS,
    }:
        raise ValidationError(
            f"Work item '{work_item_id}' cannot be claimed in status "
            f"'{work_item.status}'"
        )
    before = work_item.to_dict()
    work_item.assigned_to = crew_id
    _record_transition(data, work_item, before, actor=actor, reason="claimed", now=now)
    return work_item


def _transition(
    data: BoatData,
    work_item_id: str,
    target: WorkItemStatus,
    *,
    reason: str | None,
    actor: str | None,
    now: datetime | None,
    block_reason: str | None = None,
) -> WorkItem:
    work_item = _get_work_item(data, work_item_id)
    assert_transition(work_item.status, target)
    before = work_item.to_dict()
    instant = now or utc_now()
    work_item.status = target.value

    if target is WorkItemStatus.IN_PROGRESS and work_item.started_at_utc is None:
        work_item.started_at_utc = instant
    if target is WorkItemStatus.REVIEW:
        work_item.submitted_for_review_at_utc = instant
    if target is WorkItemStatus.BLOCKED:
        work_item.block_reason = block_reason
    else:
        work_item.block_reason = None

    _record_transition(data, work_item, before, actor=actor, reason=reason, now=instant)
    return work_item


def start_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    return _transition(
        data,
        work_item_id,
        WorkItemStatus.IN_PROGRESS,
        reason="started",
        actor=actor,
        now=now,
    )


def submit_for_review(
    data: BoatData,
    *,
    work_item_id: str,
    completion_notes: str | None = None,
    evidence_refs: list[str] | None = None,
    inventory_used: list[dict[str, Any]] | None = None,
    meter_readings: dict[str, Any] | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    """Submit in-progress work for verification, attaching completion data."""
    work_item = _get_work_item(data, work_item_id)
    if inventory_used:
        usages = [InventoryUsage.from_dict(u) for u in inventory_used]
        validate_refs([u.inventory_id for u in usages], data.inventory, "inventory")
        work_item.inventory_used = usages
    if completion_notes is not None:
        work_item.completion_notes = completion_notes
    if evidence_refs is not None:
        work_item.evidence_refs = list(evidence_refs)
    if meter_readings is not None:
        work_item.meter_readings = dict(meter_readings)
    return _transition(
        data,
        work_item_id,
        WorkItemStatus.REVIEW,
        reason="submitted for review",
        actor=actor,
        now=now,
    )


def block_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    block_reason: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    return _transition(
        data,
        work_item_id,
        WorkItemStatus.BLOCKED,
        reason=block_reason or "blocked",
        actor=actor,
        now=now,
        block_reason=block_reason,
    )


def defer_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    reason: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    return _transition(
        data,
        work_item_id,
        WorkItemStatus.DEFERRED,
        reason=reason or "deferred",
        actor=actor,
        now=now,
    )


def cancel_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    reason: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    return _transition(
        data,
        work_item_id,
        WorkItemStatus.CANCELLED,
        reason=reason or "cancelled",
        actor=actor,
        now=now,
    )


def unblock_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    target: str = WorkItemStatus.TODO.value,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    """Move a blocked/deferred item back into the active flow."""
    return _transition(
        data,
        work_item_id,
        WorkItemStatus(target),
        reason="unblocked",
        actor=actor,
        now=now,
    )


def reopen_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    reason: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> WorkItem:
    """Reopen a completed work item by creating a corrective work item.

    Reopening never deletes or mutates the immutable maintenance log entry for
    the original work (AGENTS.md). Instead a new ``todo`` work item is created
    that references the same catalogue task, preserving history.
    """
    original = _get_work_item(data, work_item_id)
    if WorkItemStatus(original.status) is not WorkItemStatus.DONE:
        raise ValidationError(
            f"Only completed work items can be reopened; '{work_item_id}' is "
            f"'{original.status}'"
        )
    corrective = create_work_item(
        data,
        catalogue_task_id=original.catalogue_task_id,
        trigger_source=original.trigger_source,
        trigger_key=original.trigger_key,
        operational_context_id=original.operational_context_id,
        title=f"Corrective: {original.title or original.catalogue_task_id}",
        actor=actor,
        now=now,
    )
    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="work_item",
        object_id=original.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        reason=reason or f"reopened as corrective work item {corrective.id}",
        after={"corrective_work_item_id": corrective.id},
        now=now,
    )
    return corrective
