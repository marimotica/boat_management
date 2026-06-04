"""Tests that entity projections reflect Work Item state."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from custom_components.boat_management.const import (
    DOMAIN,
    SERVICE_CREATE_CATALOGUE_TASK,
    SERVICE_CREATE_WORK_ITEM,
)


def _entity_id(hass: HomeAssistant, entry_id: str, unique_suffix: str) -> str:
    ent_reg = er.async_get(hass)
    unique_id = f"{entry_id}_{unique_suffix}"
    entity_id = ent_reg.async_get_entity_id("sensor", DOMAIN, unique_id)
    assert entity_id is not None, f"missing entity for {unique_id}"
    return entity_id


async def test_open_work_items_sensor_updates(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, coordinator = setup_vessel
    sensor_id = _entity_id(hass, entry.entry_id, "open_work_items")
    assert hass.states.get(sensor_id).state == "0"

    await hass.services.async_call(
        DOMAIN, SERVICE_CREATE_CATALOGUE_TASK, {"title": "Inspect"}, blocking=True
    )
    task_id = next(iter(coordinator.data.task_catalogue))
    await hass.services.async_call(
        DOMAIN,
        SERVICE_CREATE_WORK_ITEM,
        {"catalogue_task_id": task_id},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get(sensor_id).state == "1"


async def test_todo_entity_reflects_active_work_items(
    hass: HomeAssistant, setup_vessel
) -> None:
    entry, coordinator = setup_vessel
    ent_reg = er.async_get(hass)
    todo_id = ent_reg.async_get_entity_id(
        "todo", DOMAIN, f"{entry.entry_id}_work_items"
    )
    assert todo_id is not None

    await hass.services.async_call(
        DOMAIN, SERVICE_CREATE_CATALOGUE_TASK, {"title": "Inspect"}, blocking=True
    )
    task_id = next(iter(coordinator.data.task_catalogue))
    await hass.services.async_call(
        DOMAIN,
        SERVICE_CREATE_WORK_ITEM,
        {"catalogue_task_id": task_id, "title": "Inspect rig"},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get(todo_id)
    assert int(state.state) >= 1
