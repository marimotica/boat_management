"""Binary sensor: whether the vessel requires attention.

A single aggregate that is ``on`` when there is open work in review/blocked,
overdue work, or low-stock inventory. Detailed counts live on the sensors.
"""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, WorkItemStatus
from .coordinator import BoatCoordinator
from .data import BoatData
from .equipment import equipment_due_for_maintenance


def _requires_attention(data: BoatData) -> bool:
    for w in data.work_items.values():
        if WorkItemStatus(w.status) in {
            WorkItemStatus.REVIEW,
            WorkItemStatus.BLOCKED,
        }:
            return True
    for item in data.inventory.values():
        if item.active and (item.is_low_stock() or item.expired):
            return True
    return bool(equipment_due_for_maintenance(data))


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: BoatCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([BoatRequiresAttentionBinarySensor(coordinator)])


class BoatRequiresAttentionBinarySensor(BinarySensorEntity):
    """On when the vessel has work or inventory needing attention."""

    _attr_has_entity_name = True
    _attr_name = "Requires attention"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, coordinator: BoatCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry.entry_id}_requires_attention"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._coordinator.async_add_listener(self.async_write_ha_state)
        )

    @property
    def is_on(self) -> bool:
        return _requires_attention(self._coordinator.data)
