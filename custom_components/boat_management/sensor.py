"""Aggregate sensors for boat_management.

Per AGENTS.md, v1 prefers a small set of aggregate sensors over many per-object
entities. Each sensor is a projection computed from the coordinator's live
:class:`BoatData`; unique ids are derived from the config entry id and a stable
key, never from display names.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import ACTIVE_WORK_STATUSES, DOMAIN, WorkItemStatus
from .coordinator import BoatCoordinator
from .data import BoatData
from .equipment import equipment_due_for_maintenance
from .timezone import parse_utc, utc_now


@dataclass(frozen=True, kw_only=True)
class BoatSensorDescription(SensorEntityDescription):
    """Sensor description with a value function over BoatData."""

    value_fn: Callable[[BoatData], int | str | None]


def _count_status(data: BoatData, status: WorkItemStatus) -> int:
    return sum(1 for w in data.work_items.values() if w.status == status.value)


def _open_work(data: BoatData) -> int:
    return sum(
        1
        for w in data.work_items.values()
        if WorkItemStatus(w.status) in ACTIVE_WORK_STATUSES
    )


def _overdue(data: BoatData) -> int:
    now = utc_now()
    count = 0
    for w in data.work_items.values():
        if WorkItemStatus(w.status) not in ACTIVE_WORK_STATUSES:
            continue
        if not w.due_date:
            continue
        try:
            due = parse_utc(w.due_date)
        except ValueError:
            continue
        if due < now:
            count += 1
    return count


def _low_stock(data: BoatData) -> int:
    return sum(1 for i in data.inventory.values() if i.active and i.is_low_stock())


def _expiring(data: BoatData) -> int:
    return sum(1 for i in data.inventory.values() if i.active and i.expired)


def _equipment_due_maintenance(data: BoatData) -> int:
    return len(equipment_due_for_maintenance(data))


def _last_maintenance(data: BoatData) -> str | None:
    latest: datetime | None = None
    for entry in data.maintenance_log.values():
        if latest is None or entry.completed_at_utc > latest:
            latest = entry.completed_at_utc
    return latest.isoformat() if latest else None


SENSOR_DESCRIPTIONS: tuple[BoatSensorDescription, ...] = (
    BoatSensorDescription(
        key="open_work_items",
        name="Open work items",
        icon="mdi:clipboard-list",
        value_fn=_open_work,
    ),
    BoatSensorDescription(
        key="items_in_review",
        name="Items in review",
        icon="mdi:clipboard-check",
        value_fn=lambda d: _count_status(d, WorkItemStatus.REVIEW),
    ),
    BoatSensorDescription(
        key="blocked_items",
        name="Blocked items",
        icon="mdi:cancel",
        value_fn=lambda d: _count_status(d, WorkItemStatus.BLOCKED),
    ),
    BoatSensorDescription(
        key="overdue_items",
        name="Overdue items",
        icon="mdi:alert",
        value_fn=_overdue,
    ),
    BoatSensorDescription(
        key="inventory_low_stock",
        name="Inventory low stock",
        icon="mdi:package-down",
        value_fn=_low_stock,
    ),
    BoatSensorDescription(
        key="expiring_inventory",
        name="Expiring inventory",
        icon="mdi:clock-alert",
        value_fn=_expiring,
    ),
    BoatSensorDescription(
        key="equipment_due_maintenance",
        name="Equipment due maintenance",
        icon="mdi:wrench-cog",
        value_fn=_equipment_due_maintenance,
    ),
    BoatSensorDescription(
        key="last_maintenance",
        name="Last maintenance",
        icon="mdi:wrench-clock",
        value_fn=_last_maintenance,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: BoatCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        BoatAggregateSensor(coordinator, desc) for desc in SENSOR_DESCRIPTIONS
    )


class BoatAggregateSensor(SensorEntity):
    """A single aggregate projection over vessel state."""

    _attr_has_entity_name = True
    entity_description: BoatSensorDescription

    def __init__(
        self, coordinator: BoatCoordinator, description: BoatSensorDescription
    ) -> None:
        self._coordinator = coordinator
        self.entity_description = description
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{description.key}"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._coordinator.async_add_listener(self.async_write_ha_state)
        )

    @property
    def native_value(self) -> int | str | None:
        return self.entity_description.value_fn(self._coordinator.data)
