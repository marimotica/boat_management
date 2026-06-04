"""Todo platform: projects active Work Items.

The todo entity is a *projection*, never the source of truth (AGENTS.md). The
backend Work Item model remains canonical; completing a todo routes through the
same lifecycle services rather than flattening state. Richer states are kept in
item attributes.
"""

from __future__ import annotations

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import ACTIVE_WORK_STATUSES, DOMAIN, WorkItemStatus
from .coordinator import BoatCoordinator

#: Backend statuses considered "completed/closed" from HA's binary perspective.
_DONE_STATUSES = frozenset({WorkItemStatus.DONE, WorkItemStatus.CANCELLED})


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: BoatCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([BoatWorkItemsTodoList(coordinator)])


class BoatWorkItemsTodoList(TodoListEntity):
    """Active Work Items exposed as a todo list."""

    _attr_has_entity_name = True
    _attr_name = "Work items"
    _attr_supported_features = TodoListEntityFeature(0)

    def __init__(self, coordinator: BoatCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry.entry_id}_work_items"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._coordinator.async_add_listener(self.async_write_ha_state)
        )

    @callback
    def _to_todo_item(self, work_item_id: str) -> TodoItem:
        wi = self._coordinator.data.work_items[work_item_id]
        status = WorkItemStatus(wi.status)
        ha_status = (
            TodoItemStatus.COMPLETED
            if status in _DONE_STATUSES
            else TodoItemStatus.NEEDS_ACTION
        )
        return TodoItem(
            uid=wi.id,
            summary=wi.title or wi.catalogue_task_id,
            status=ha_status,
            due=None,
        )

    @property
    def todo_items(self) -> list[TodoItem]:
        items: list[TodoItem] = []
        for wi in self._coordinator.data.work_items.values():
            if WorkItemStatus(wi.status) in ACTIVE_WORK_STATUSES:
                items.append(self._to_todo_item(wi.id))
        return items
