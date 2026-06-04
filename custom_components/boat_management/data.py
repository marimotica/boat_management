"""Pure in-memory data container for one vessel's state.

``BoatData`` is the canonical typed representation of everything the
integration manages for a single config entry. It is deliberately free of any
Home Assistant import so that domain-operation modules (equipment, inventory,
work_items, ...) and tests can manipulate vessel state without a running HA
instance. Persistence concerns live in :mod:`storage`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .const import STORAGE_VERSION
from .models import (
    AuditEvent,
    CrewMember,
    Equipment,
    InventoryItem,
    MaintenanceLogEntry,
    System,
    TaskCatalogueItem,
    Vessel,
    WorkItem,
)


@dataclass(slots=True)
class BoatData:
    """Typed, in-memory representation of all vessel state for one entry."""

    vessel: Vessel
    systems: dict[str, System] = field(default_factory=dict)
    equipment: dict[str, Equipment] = field(default_factory=dict)
    inventory: dict[str, InventoryItem] = field(default_factory=dict)
    task_catalogue: dict[str, TaskCatalogueItem] = field(default_factory=dict)
    work_items: dict[str, WorkItem] = field(default_factory=dict)
    maintenance_log: dict[str, MaintenanceLogEntry] = field(default_factory=dict)
    crew: dict[str, CrewMember] = field(default_factory=dict)
    documents: dict[str, dict[str, Any]] = field(default_factory=dict)
    audit_events: dict[str, AuditEvent] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": STORAGE_VERSION,
            "vessel": self.vessel.to_dict(),
            "systems": {k: v.to_dict() for k, v in self.systems.items()},
            "equipment": {k: v.to_dict() for k, v in self.equipment.items()},
            "inventory": {k: v.to_dict() for k, v in self.inventory.items()},
            "task_catalogue": {k: v.to_dict() for k, v in self.task_catalogue.items()},
            "work_items": {k: v.to_dict() for k, v in self.work_items.items()},
            "maintenance_log": {
                k: v.to_dict() for k, v in self.maintenance_log.items()
            },
            "crew": {k: v.to_dict() for k, v in self.crew.items()},
            "documents": dict(self.documents),
            "audit_events": {k: v.to_dict() for k, v in self.audit_events.items()},
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> BoatData:
        return cls(
            vessel=Vessel.from_dict(raw["vessel"]),
            systems={
                k: System.from_dict(v) for k, v in (raw.get("systems") or {}).items()
            },
            equipment={
                k: Equipment.from_dict(v)
                for k, v in (raw.get("equipment") or {}).items()
            },
            inventory={
                k: InventoryItem.from_dict(v)
                for k, v in (raw.get("inventory") or {}).items()
            },
            task_catalogue={
                k: TaskCatalogueItem.from_dict(v)
                for k, v in (raw.get("task_catalogue") or {}).items()
            },
            work_items={
                k: WorkItem.from_dict(v)
                for k, v in (raw.get("work_items") or {}).items()
            },
            maintenance_log={
                k: MaintenanceLogEntry.from_dict(v)
                for k, v in (raw.get("maintenance_log") or {}).items()
            },
            crew={
                k: CrewMember.from_dict(v) for k, v in (raw.get("crew") or {}).items()
            },
            documents=dict(raw.get("documents") or {}),
            audit_events={
                k: AuditEvent.from_dict(v)
                for k, v in (raw.get("audit_events") or {}).items()
            },
        )
