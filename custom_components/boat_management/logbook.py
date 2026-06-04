"""Maintenance Logbook verification transaction (pure over :class:`BoatData`).

Verification is the single domain-level operation that moves a work item from
``review`` to ``done`` and creates an immutable Maintenance Log Entry. It is
the only path that writes history, and it never mutates existing log entries
(corrections are amendments). See DESIGN.md "Work Item Lifecycle".
"""

from __future__ import annotations

from datetime import datetime

from .audit import record_audit
from .const import VERIFIER_ROLES, AuditEventType, CrewRole, WorkItemStatus
from .data import BoatData
from .models import (
    InventoryUsage,
    LogbookAmendment,
    MaintenanceLogEntry,
    new_id,
)
from .timezone import EventTimestamp, utc_now
from .transitions import assert_transition
from .validators import (
    ValidationError,
    require_existing,
    validate_consumption,
)


def _check_verifier(data: BoatData, verifier_id: str | None) -> str:
    """Validate the verifier exists and holds a verifying role."""
    if not verifier_id:
        raise ValidationError("Verification requires a verifier")
    require_existing(verifier_id, data.crew, "crew member")
    crew = data.crew[verifier_id]
    try:
        role = CrewRole(crew.role)
    except ValueError as err:
        raise ValidationError(
            f"Crew member '{crew.name}' has unknown role '{crew.role}'"
        ) from err
    if role not in VERIFIER_ROLES:
        raise ValidationError(
            f"Crew member '{crew.name}' (role '{crew.role}') is not permitted "
            "to verify work"
        )
    return verifier_id


def verify_work_item(
    data: BoatData,
    *,
    work_item_id: str,
    verified_by: str,
    consume_inventory: bool = True,
    notes: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> MaintenanceLogEntry:
    """Verify reviewed work, creating an immutable log entry.

    Transaction (DESIGN.md): validate state, verifier, catalogue task, and
    inventory; create the log entry; deduct inventory if configured; mark the
    work item done; update catalogue last-completed; write audit events.

    All validation happens before any mutation so a failure leaves state
    untouched (no partial writes).
    """
    require_existing(work_item_id, data.work_items, "work item")
    work_item = data.work_items[work_item_id]

    # 1. State must be 'review'.
    assert_transition(work_item.status, WorkItemStatus.DONE)

    # 2. Verifier role.
    verifier_id = _check_verifier(data, verified_by)

    # 3. Catalogue task must still exist.
    require_existing(work_item.catalogue_task_id, data.task_catalogue, "catalogue task")
    task = data.task_catalogue[work_item.catalogue_task_id]

    # 4/5. Validate inventory usage and availability up front.
    usages: list[InventoryUsage] = list(work_item.inventory_used)
    if consume_inventory:
        for usage in usages:
            require_existing(usage.inventory_id, data.inventory, "inventory")
            validate_consumption(data.inventory[usage.inventory_id], usage.quantity)

    instant = now or utc_now()
    stamp = EventTimestamp.capture(data.vessel.current_timezone, now=instant)
    before_work = work_item.to_dict()

    # 6. Create the immutable log entry, snapshotting state as it was now.
    entry = MaintenanceLogEntry(
        id=new_id("log"),
        catalogue_task_id=work_item.catalogue_task_id,
        work_item_id=work_item.id,
        verified_by=verifier_id,
        completed_by=work_item.assigned_to,
        completed_at_utc=instant,
        completed_at_local=stamp.local_iso,
        timezone_at_completion=stamp.timezone_name,
        verified_at_utc=instant,
        system_refs=list(task.system_refs),
        equipment_refs=list(task.equipment_refs),
        notes=notes if notes is not None else work_item.completion_notes,
        evidence_refs=list(work_item.evidence_refs),
        consumables_used=[InventoryUsage(u.inventory_id, u.quantity) for u in usages],
        meter_readings=dict(work_item.meter_readings),
        trigger_source=work_item.trigger_source,
    )
    data.maintenance_log[entry.id] = entry

    # 7. Deduct inventory (already validated as sufficient).
    if consume_inventory:
        for usage in usages:
            item = data.inventory[usage.inventory_id]
            item_before = item.to_dict()
            item.quantity -= usage.quantity
            record_audit(
                data.audit_events,
                event_type=AuditEventType.CONSUME,
                object_type="inventory",
                object_id=item.id,
                timezone_name=data.vessel.current_timezone,
                actor=actor,
                before=item_before,
                after=item.to_dict(),
                reason=f"consumed by work item {work_item.id}",
                now=instant,
            )

    # 8. Mark work item done.
    work_item.status = WorkItemStatus.DONE.value
    work_item.finished_at_utc = instant
    work_item.verified_by = verifier_id
    work_item.verified_at_utc = instant
    work_item.timezone_at_completion = stamp.timezone_name

    # 9. Update catalogue last-completed summary.
    task.last_completed_at_utc = instant

    # 10. Audit events.
    record_audit(
        data.audit_events,
        event_type=AuditEventType.VERIFY,
        object_type="work_item",
        object_id=work_item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor or verifier_id,
        before=before_work,
        after=work_item.to_dict(),
        reason=f"verified into log entry {entry.id}",
        now=instant,
    )
    record_audit(
        data.audit_events,
        event_type=AuditEventType.CREATE,
        object_type="maintenance_log",
        object_id=entry.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor or verifier_id,
        after=entry.to_dict(),
        now=instant,
    )
    return entry


def amend_log_entry(
    data: BoatData,
    *,
    log_entry_id: str,
    note: str,
    author: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> MaintenanceLogEntry:
    """Append an amendment to an immutable log entry.

    The original entry is never mutated; corrections are recorded as appended
    amendments only.
    """
    require_existing(log_entry_id, data.maintenance_log, "log entry")
    if not note or not note.strip():
        raise ValidationError("Amendment note cannot be empty")
    entry = data.maintenance_log[log_entry_id]
    instant = now or utc_now()
    stamp = EventTimestamp.capture(data.vessel.current_timezone, now=instant)
    amendment = LogbookAmendment(
        id=new_id("amend"),
        author=author,
        created_at_utc=instant,
        note=note.strip(),
        timezone_at_event=stamp.timezone_name,
    )
    entry.amendments.append(amendment)
    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="maintenance_log",
        object_id=entry.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        after={"amendment_id": amendment.id, "note": amendment.note},
        reason="logbook amendment",
        now=instant,
    )
    return entry
