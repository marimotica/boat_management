"""Typed domain models for boat_management.

These dataclasses are the canonical representation of vessel state. They are
pure Python (no Home Assistant imports) so they can be unit-tested directly and
reused by storage, services, websocket handlers and import/export.

Serialization is explicit: ``to_dict``/``from_dict`` round-trip cleanly and
preserve unknown future-safe fields via ``extra`` where practical.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
import uuid

from .const import (
    TimezoneSource,
    TriggerSource,
    WorkItemStatus,
)
from .timezone import parse_utc, to_utc_iso


def new_id(prefix: str) -> str:
    """Generate a stable, opaque object id.

    IDs are identity and must never be derived from display names (AGENTS.md).
    The prefix is purely a debugging convenience.
    """
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _dec(value: Any) -> Decimal:
    """Coerce to Decimal, rejecting junk with an actionable error."""
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as err:
        raise ValueError(f"Invalid numeric quantity: {value!r}") from err


def _opt_dt(value: str | None) -> datetime | None:
    return parse_utc(value) if value else None


def _opt_dt_iso(value: datetime | None) -> str | None:
    return to_utc_iso(value) if value else None


# ---------------------------------------------------------------------------
# Vessel
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class Vessel:
    """Root object. Identity is stable; name is display-only."""

    id: str
    name: str
    default_timezone: str
    current_timezone: str
    timezone_source: str = TimezoneSource.MANUAL.value
    timezone_updated_at_utc: datetime | None = None
    vessel_type: str | None = None
    callsign: str | None = None
    mmsi: str | None = None
    home_port: str | None = None
    units: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "default_timezone": self.default_timezone,
            "current_timezone": self.current_timezone,
            "timezone_source": self.timezone_source,
            "timezone_updated_at_utc": _opt_dt_iso(self.timezone_updated_at_utc),
            "vessel_type": self.vessel_type,
            "callsign": self.callsign,
            "mmsi": self.mmsi,
            "home_port": self.home_port,
            "units": dict(self.units),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Vessel:
        return cls(
            id=data["id"],
            name=data["name"],
            default_timezone=data["default_timezone"],
            current_timezone=data["current_timezone"],
            timezone_source=data.get("timezone_source", TimezoneSource.MANUAL.value),
            timezone_updated_at_utc=_opt_dt(data.get("timezone_updated_at_utc")),
            vessel_type=data.get("vessel_type"),
            callsign=data.get("callsign"),
            mmsi=data.get("mmsi"),
            home_port=data.get("home_port"),
            units=dict(data.get("units") or {}),
        )


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class System:
    id: str
    name: str
    category: str | None = None
    description: str | None = None
    parent_system_id: str | None = None
    active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "parent_system_id": self.parent_system_id,
            "active": self.active,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> System:
        return cls(
            id=data["id"],
            name=data["name"],
            category=data.get("category"),
            description=data.get("description"),
            parent_system_id=data.get("parent_system_id"),
            active=data.get("active", True),
        )


# ---------------------------------------------------------------------------
# Equipment
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class Equipment:
    id: str
    name: str
    system_id: str | None = None
    category: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    serial_number: str | None = None
    location: str | None = None
    installed_date: str | None = None
    commissioned_date: str | None = None
    retired_date: str | None = None
    documentation_refs: list[str] = field(default_factory=list)
    inventory_refs: list[str] = field(default_factory=list)
    meter_refs: list[str] = field(default_factory=list)
    # Opaque ids of uploaded document/photo blobs (see media.py). Managed only
    # through the attach/detach media ops, never free-form edits, so the audit
    # trail stays authoritative.
    media_refs: list[str] = field(default_factory=list)
    # Optional calendar maintenance interval (days). Drives the
    # equipment-due-maintenance projection; ``None`` means no schedule.
    maintenance_interval_days: int | None = None
    active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "system_id": self.system_id,
            "category": self.category,
            "manufacturer": self.manufacturer,
            "model": self.model,
            "serial_number": self.serial_number,
            "location": self.location,
            "installed_date": self.installed_date,
            "commissioned_date": self.commissioned_date,
            "retired_date": self.retired_date,
            "documentation_refs": list(self.documentation_refs),
            "inventory_refs": list(self.inventory_refs),
            "meter_refs": list(self.meter_refs),
            "media_refs": list(self.media_refs),
            "maintenance_interval_days": self.maintenance_interval_days,
            "active": self.active,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Equipment:
        return cls(
            id=data["id"],
            name=data["name"],
            system_id=data.get("system_id"),
            category=data.get("category"),
            manufacturer=data.get("manufacturer"),
            model=data.get("model"),
            serial_number=data.get("serial_number"),
            location=data.get("location"),
            installed_date=data.get("installed_date"),
            commissioned_date=data.get("commissioned_date"),
            retired_date=data.get("retired_date"),
            documentation_refs=list(data.get("documentation_refs") or []),
            inventory_refs=list(data.get("inventory_refs") or []),
            meter_refs=list(data.get("meter_refs") or []),
            media_refs=list(data.get("media_refs") or []),
            maintenance_interval_days=data.get("maintenance_interval_days"),
            active=data.get("active", True),
        )


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class InventoryItem:
    id: str
    name: str
    quantity: Decimal = Decimal("0")
    unit: str = "ea"
    category: str | None = None
    manufacturer: str | None = None
    part_number: str | None = None
    storage_location: str | None = None
    minimum_stock: Decimal | None = None
    reorder_level: Decimal | None = None
    equipment_refs: list[str] = field(default_factory=list)
    supplier_refs: list[str] = field(default_factory=list)
    # Opaque ids of uploaded document/photo blobs (see media.py); attach/detach
    # ops only, mirroring Equipment.media_refs.
    media_refs: list[str] = field(default_factory=list)
    expiry_date: str | None = None
    expired: bool = False
    active: bool = True

    def is_low_stock(self) -> bool:
        """True when stock at/below the reorder or minimum threshold."""
        threshold = self.reorder_level
        if threshold is None:
            threshold = self.minimum_stock
        if threshold is None:
            return False
        return self.quantity <= threshold

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "quantity": str(self.quantity),
            "unit": self.unit,
            "category": self.category,
            "manufacturer": self.manufacturer,
            "part_number": self.part_number,
            "storage_location": self.storage_location,
            "minimum_stock": (
                None if self.minimum_stock is None else str(self.minimum_stock)
            ),
            "reorder_level": (
                None if self.reorder_level is None else str(self.reorder_level)
            ),
            "equipment_refs": list(self.equipment_refs),
            "supplier_refs": list(self.supplier_refs),
            "media_refs": list(self.media_refs),
            "expiry_date": self.expiry_date,
            "expired": self.expired,
            "active": self.active,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> InventoryItem:
        min_stock = data.get("minimum_stock")
        reorder = data.get("reorder_level")
        return cls(
            id=data["id"],
            name=data["name"],
            quantity=_dec(data.get("quantity", "0")),
            unit=data.get("unit", "ea"),
            category=data.get("category"),
            manufacturer=data.get("manufacturer"),
            part_number=data.get("part_number"),
            storage_location=data.get("storage_location"),
            minimum_stock=None if min_stock is None else _dec(min_stock),
            reorder_level=None if reorder is None else _dec(reorder),
            equipment_refs=list(data.get("equipment_refs") or []),
            supplier_refs=list(data.get("supplier_refs") or []),
            media_refs=list(data.get("media_refs") or []),
            expiry_date=data.get("expiry_date"),
            expired=data.get("expired", False),
            active=data.get("active", True),
        )


@dataclass(slots=True)
class InventoryUsage:
    """A quantity of an inventory item consumed by work."""

    inventory_id: str
    quantity: Decimal

    def to_dict(self) -> dict[str, Any]:
        return {"inventory_id": self.inventory_id, "quantity": str(self.quantity)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> InventoryUsage:
        return cls(inventory_id=data["inventory_id"], quantity=_dec(data["quantity"]))


# ---------------------------------------------------------------------------
# Task Catalogue
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class TriggerRule:
    """A rule on a catalogue task describing when it should be instantiated."""

    source: str
    key: str | None = None
    threshold: float | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "key": self.key,
            "threshold": self.threshold,
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TriggerRule:
        return cls(
            source=data["source"],
            key=data.get("key"),
            threshold=data.get("threshold"),
            meta=dict(data.get("meta") or {}),
        )


@dataclass(slots=True)
class TaskCatalogueItem:
    id: str
    title: str
    description: str | None = None
    system_refs: list[str] = field(default_factory=list)
    equipment_refs: list[str] = field(default_factory=list)
    inventory_refs: list[str] = field(default_factory=list)
    required_skills: list[str] = field(default_factory=list)
    estimated_duration_minutes: int | None = None
    procedure: str | None = None
    safety_notes: str | None = None
    default_verifier: str | None = None
    trigger_rules: list[TriggerRule] = field(default_factory=list)
    last_completed_at_utc: datetime | None = None
    active: bool = True
    owner_curated: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "system_refs": list(self.system_refs),
            "equipment_refs": list(self.equipment_refs),
            "inventory_refs": list(self.inventory_refs),
            "required_skills": list(self.required_skills),
            "estimated_duration_minutes": self.estimated_duration_minutes,
            "procedure": self.procedure,
            "safety_notes": self.safety_notes,
            "default_verifier": self.default_verifier,
            "trigger_rules": [r.to_dict() for r in self.trigger_rules],
            "last_completed_at_utc": _opt_dt_iso(self.last_completed_at_utc),
            "active": self.active,
            "owner_curated": self.owner_curated,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskCatalogueItem:
        return cls(
            id=data["id"],
            title=data["title"],
            description=data.get("description"),
            system_refs=list(data.get("system_refs") or []),
            equipment_refs=list(data.get("equipment_refs") or []),
            inventory_refs=list(data.get("inventory_refs") or []),
            required_skills=list(data.get("required_skills") or []),
            estimated_duration_minutes=data.get("estimated_duration_minutes"),
            procedure=data.get("procedure"),
            safety_notes=data.get("safety_notes"),
            default_verifier=data.get("default_verifier"),
            trigger_rules=[
                TriggerRule.from_dict(r) for r in (data.get("trigger_rules") or [])
            ],
            last_completed_at_utc=_opt_dt(data.get("last_completed_at_utc")),
            active=data.get("active", True),
            owner_curated=data.get("owner_curated", True),
        )


# ---------------------------------------------------------------------------
# Work Item
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class WorkItem:
    id: str
    catalogue_task_id: str
    status: str = WorkItemStatus.TODO.value
    trigger_source: str = TriggerSource.MANUAL.value
    trigger_key: str | None = None
    operational_context_id: str | None = None
    title: str | None = None
    assigned_to: str | None = None
    due_date: str | None = None
    created_at_utc: datetime | None = None
    started_at_utc: datetime | None = None
    finished_at_utc: datetime | None = None
    submitted_for_review_at_utc: datetime | None = None
    verified_by: str | None = None
    verified_at_utc: datetime | None = None
    timezone_at_creation: str = "UTC"
    timezone_at_completion: str | None = None
    completion_notes: str | None = None
    block_reason: str | None = None
    evidence_refs: list[str] = field(default_factory=list)
    inventory_used: list[InventoryUsage] = field(default_factory=list)
    meter_readings: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "catalogue_task_id": self.catalogue_task_id,
            "status": self.status,
            "trigger_source": self.trigger_source,
            "trigger_key": self.trigger_key,
            "operational_context_id": self.operational_context_id,
            "title": self.title,
            "assigned_to": self.assigned_to,
            "due_date": self.due_date,
            "created_at_utc": _opt_dt_iso(self.created_at_utc),
            "started_at_utc": _opt_dt_iso(self.started_at_utc),
            "finished_at_utc": _opt_dt_iso(self.finished_at_utc),
            "submitted_for_review_at_utc": _opt_dt_iso(
                self.submitted_for_review_at_utc
            ),
            "verified_by": self.verified_by,
            "verified_at_utc": _opt_dt_iso(self.verified_at_utc),
            "timezone_at_creation": self.timezone_at_creation,
            "timezone_at_completion": self.timezone_at_completion,
            "completion_notes": self.completion_notes,
            "block_reason": self.block_reason,
            "evidence_refs": list(self.evidence_refs),
            "inventory_used": [u.to_dict() for u in self.inventory_used],
            "meter_readings": dict(self.meter_readings),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkItem:
        return cls(
            id=data["id"],
            catalogue_task_id=data["catalogue_task_id"],
            status=data.get("status", WorkItemStatus.TODO.value),
            trigger_source=data.get("trigger_source", TriggerSource.MANUAL.value),
            trigger_key=data.get("trigger_key"),
            operational_context_id=data.get("operational_context_id"),
            title=data.get("title"),
            assigned_to=data.get("assigned_to"),
            due_date=data.get("due_date"),
            created_at_utc=_opt_dt(data.get("created_at_utc")),
            started_at_utc=_opt_dt(data.get("started_at_utc")),
            finished_at_utc=_opt_dt(data.get("finished_at_utc")),
            submitted_for_review_at_utc=_opt_dt(
                data.get("submitted_for_review_at_utc")
            ),
            verified_by=data.get("verified_by"),
            verified_at_utc=_opt_dt(data.get("verified_at_utc")),
            timezone_at_creation=data.get("timezone_at_creation", "UTC"),
            timezone_at_completion=data.get("timezone_at_completion"),
            completion_notes=data.get("completion_notes"),
            block_reason=data.get("block_reason"),
            evidence_refs=list(data.get("evidence_refs") or []),
            inventory_used=[
                InventoryUsage.from_dict(u) for u in (data.get("inventory_used") or [])
            ],
            meter_readings=dict(data.get("meter_readings") or {}),
        )


# ---------------------------------------------------------------------------
# Maintenance Logbook (immutable, append-only)
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class LogbookAmendment:
    id: str
    author: str | None
    created_at_utc: datetime
    note: str
    timezone_at_event: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "author": self.author,
            "created_at_utc": to_utc_iso(self.created_at_utc),
            "note": self.note,
            "timezone_at_event": self.timezone_at_event,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LogbookAmendment:
        return cls(
            id=data["id"],
            author=data.get("author"),
            created_at_utc=parse_utc(data["created_at_utc"]),
            note=data["note"],
            timezone_at_event=data["timezone_at_event"],
        )


@dataclass(slots=True)
class MaintenanceLogEntry:
    id: str
    catalogue_task_id: str
    work_item_id: str
    verified_by: str
    completed_at_utc: datetime
    completed_at_local: str
    timezone_at_completion: str
    verified_at_utc: datetime
    completed_by: str | None = None
    system_refs: list[str] = field(default_factory=list)
    equipment_refs: list[str] = field(default_factory=list)
    notes: str | None = None
    evidence_refs: list[str] = field(default_factory=list)
    consumables_used: list[InventoryUsage] = field(default_factory=list)
    meter_readings: dict[str, Any] = field(default_factory=dict)
    trigger_source: str = TriggerSource.MANUAL.value
    amendments: list[LogbookAmendment] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "catalogue_task_id": self.catalogue_task_id,
            "work_item_id": self.work_item_id,
            "verified_by": self.verified_by,
            "completed_by": self.completed_by,
            "completed_at_utc": to_utc_iso(self.completed_at_utc),
            "completed_at_local": self.completed_at_local,
            "timezone_at_completion": self.timezone_at_completion,
            "verified_at_utc": to_utc_iso(self.verified_at_utc),
            "system_refs": list(self.system_refs),
            "equipment_refs": list(self.equipment_refs),
            "notes": self.notes,
            "evidence_refs": list(self.evidence_refs),
            "consumables_used": [u.to_dict() for u in self.consumables_used],
            "meter_readings": dict(self.meter_readings),
            "trigger_source": self.trigger_source,
            "amendments": [a.to_dict() for a in self.amendments],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MaintenanceLogEntry:
        return cls(
            id=data["id"],
            catalogue_task_id=data["catalogue_task_id"],
            work_item_id=data["work_item_id"],
            verified_by=data["verified_by"],
            completed_by=data.get("completed_by"),
            completed_at_utc=parse_utc(data["completed_at_utc"]),
            completed_at_local=data["completed_at_local"],
            timezone_at_completion=data["timezone_at_completion"],
            verified_at_utc=parse_utc(data["verified_at_utc"]),
            system_refs=list(data.get("system_refs") or []),
            equipment_refs=list(data.get("equipment_refs") or []),
            notes=data.get("notes"),
            evidence_refs=list(data.get("evidence_refs") or []),
            consumables_used=[
                InventoryUsage.from_dict(u)
                for u in (data.get("consumables_used") or [])
            ],
            meter_readings=dict(data.get("meter_readings") or {}),
            trigger_source=data.get("trigger_source", TriggerSource.MANUAL.value),
            amendments=[
                LogbookAmendment.from_dict(a) for a in (data.get("amendments") or [])
            ],
        )


# ---------------------------------------------------------------------------
# Crew
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class CrewMember:
    id: str
    name: str
    role: str
    skills: list[str] = field(default_factory=list)
    active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "skills": list(self.skills),
            "active": self.active,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CrewMember:
        return cls(
            id=data["id"],
            name=data["name"],
            role=data["role"],
            skills=list(data.get("skills") or []),
            active=data.get("active", True),
        )


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class AuditEvent:
    id: str
    event_type: str
    object_type: str
    object_id: str
    timestamp_utc: datetime
    timestamp_local: str
    timezone_at_event: str
    actor: str | None = None
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "event_type": self.event_type,
            "object_type": self.object_type,
            "object_id": self.object_id,
            "timestamp_utc": to_utc_iso(self.timestamp_utc),
            "timestamp_local": self.timestamp_local,
            "timezone_at_event": self.timezone_at_event,
            "actor": self.actor,
            "before": self.before,
            "after": self.after,
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AuditEvent:
        return cls(
            id=data["id"],
            event_type=data["event_type"],
            object_type=data["object_type"],
            object_id=data["object_id"],
            timestamp_utc=parse_utc(data["timestamp_utc"]),
            timestamp_local=data["timestamp_local"],
            timezone_at_event=data["timezone_at_event"],
            actor=data.get("actor"),
            before=data.get("before"),
            after=data.get("after"),
            reason=data.get("reason"),
        )
