"""Tests for the boat_management service write API."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
import pytest

from custom_components.boat_management.const import (
    DOMAIN,
    SERVICE_APPLY_TRIGGER_RULES,
    SERVICE_CREATE_CATALOGUE_TASK,
    SERVICE_CREATE_EQUIPMENT,
    SERVICE_CREATE_SYSTEM,
    SERVICE_CREATE_WORK_ITEM,
    SERVICE_EXPORT_DATA,
    SERVICE_LOAD_SEED_CATALOGUE,
    SERVICE_SET_VESSEL_TIMEZONE,
    SERVICE_START_WORK_ITEM,
    SERVICE_SUBMIT_FOR_REVIEW,
    SERVICE_VERIFY_WORK_ITEM,
    WorkItemStatus,
)
from custom_components.boat_management.models import (
    CrewMember,
    TaskCatalogueItem,
    TriggerRule,
)


async def test_create_system_mutates_storage(hass: HomeAssistant, setup_vessel) -> None:
    _entry, coordinator = setup_vessel
    await hass.services.async_call(
        DOMAIN, SERVICE_CREATE_SYSTEM, {"name": "Propulsion"}, blocking=True
    )
    assert any(s.name == "Propulsion" for s in coordinator.data.systems.values())


async def test_create_equipment_invalid_system_raises(
    hass: HomeAssistant, setup_vessel
) -> None:
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN,
            SERVICE_CREATE_EQUIPMENT,
            {"name": "Engine", "system_id": "missing"},
            blocking=True,
        )


async def test_set_vessel_timezone_service(hass: HomeAssistant, setup_vessel) -> None:
    _entry, coordinator = setup_vessel
    await hass.services.async_call(
        DOMAIN,
        SERVICE_SET_VESSEL_TIMEZONE,
        {"timezone": "America/New_York"},
        blocking=True,
    )
    assert coordinator.data.vessel.current_timezone == "America/New_York"


async def test_full_lifecycle_via_services(hass: HomeAssistant, setup_vessel) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.crew["cap"] = CrewMember(id="cap", name="Captain", role="captain")

    await hass.services.async_call(
        DOMAIN,
        SERVICE_CREATE_CATALOGUE_TASK,
        {"title": "Oil change"},
        blocking=True,
    )
    task_id = next(iter(coordinator.data.task_catalogue))

    await hass.services.async_call(
        DOMAIN,
        SERVICE_CREATE_WORK_ITEM,
        {"catalogue_task_id": task_id},
        blocking=True,
    )
    wi_id = next(iter(coordinator.data.work_items))

    await hass.services.async_call(
        DOMAIN, SERVICE_START_WORK_ITEM, {"work_item_id": wi_id}, blocking=True
    )
    await hass.services.async_call(
        DOMAIN, SERVICE_SUBMIT_FOR_REVIEW, {"work_item_id": wi_id}, blocking=True
    )
    await hass.services.async_call(
        DOMAIN,
        SERVICE_VERIFY_WORK_ITEM,
        {"work_item_id": wi_id, "verified_by": "cap"},
        blocking=True,
    )

    assert coordinator.data.work_items[wi_id].status == WorkItemStatus.DONE.value
    assert len(coordinator.data.maintenance_log) == 1


async def test_export_data_returns_response(hass: HomeAssistant, setup_vessel) -> None:
    response = await hass.services.async_call(
        DOMAIN,
        SERVICE_EXPORT_DATA,
        {},
        blocking=True,
        return_response=True,
    )
    assert response["export_schema_version"] == 1


async def test_load_seed_catalogue_populates_storage(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    response = await hass.services.async_call(
        DOMAIN,
        SERVICE_LOAD_SEED_CATALOGUE,
        {},
        blocking=True,
        return_response=True,
    )
    assert response["dry_run"] is False
    assert response["systems_added"]
    assert response["tasks_added"]
    assert coordinator.data.systems
    assert coordinator.data.task_catalogue


async def test_load_seed_catalogue_dry_run_does_not_mutate(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    response = await hass.services.async_call(
        DOMAIN,
        SERVICE_LOAD_SEED_CATALOGUE,
        {"dry_run": True},
        blocking=True,
        return_response=True,
    )
    assert response["dry_run"] is True
    assert response["systems_added"]
    assert coordinator.data.systems == {}
    assert coordinator.data.task_catalogue == {}


def _seed_trigger_task(coordinator, task_id, title, **rule_kwargs) -> None:
    coordinator.data.task_catalogue[task_id] = TaskCatalogueItem(
        id=task_id,
        title=title,
        trigger_rules=[TriggerRule(**rule_kwargs)],
    )


async def test_apply_trigger_rules_event_mode_creates_and_dedups(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    _seed_trigger_task(
        coordinator, "t1", "Winterize", source="seasonal_transition", key="winter"
    )

    response = await hass.services.async_call(
        DOMAIN,
        SERVICE_APPLY_TRIGGER_RULES,
        {"source": "seasonal_transition", "key": "winter"},
        blocking=True,
        return_response=True,
    )
    assert response["dry_run"] is False
    assert response["would_create"] == ["t1"]
    assert len(response["created_work_item_ids"]) == 1
    assert len(coordinator.data.work_items) == 1

    # Re-applying the same event must skip the still-open work item.
    again = await hass.services.async_call(
        DOMAIN,
        SERVICE_APPLY_TRIGGER_RULES,
        {"source": "seasonal_transition", "key": "winter"},
        blocking=True,
        return_response=True,
    )
    assert again["created_work_item_ids"] == []
    assert again["skipped_existing"] == ["t1"]
    assert len(coordinator.data.work_items) == 1


async def test_apply_trigger_rules_dry_run_does_not_create(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    _seed_trigger_task(
        coordinator, "t1", "Winterize", source="seasonal_transition", key="winter"
    )

    response = await hass.services.async_call(
        DOMAIN,
        SERVICE_APPLY_TRIGGER_RULES,
        {"source": "seasonal_transition", "key": "winter", "dry_run": True},
        blocking=True,
        return_response=True,
    )
    assert response["dry_run"] is True
    assert response["would_create"] == ["t1"]
    assert response["created_work_item_ids"] == []
    assert coordinator.data.work_items == {}


async def test_apply_trigger_rules_suggestion_mode_targets_single_task(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    # Both tasks would match a generic inventory event; suggestion mode pins the
    # exact accepted task so the rest are not swept in.
    _seed_trigger_task(
        coordinator, "t1", "Restock filters", source="inventory", key="filters"
    )
    _seed_trigger_task(coordinator, "t2", "Restock low inventory", source="inventory")

    response = await hass.services.async_call(
        DOMAIN,
        SERVICE_APPLY_TRIGGER_RULES,
        {
            "source": "inventory",
            "catalogue_task_id": "t1",
            "key": "filters",
            "context_id": "inv1",
        },
        blocking=True,
        return_response=True,
    )
    assert response["would_create"] == ["t1"]
    assert len(coordinator.data.work_items) == 1
    wi = next(iter(coordinator.data.work_items.values()))
    assert wi.catalogue_task_id == "t1"


async def test_apply_trigger_rules_unknown_task_raises(
    hass: HomeAssistant, setup_vessel
) -> None:
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN,
            SERVICE_APPLY_TRIGGER_RULES,
            {"source": "inventory", "catalogue_task_id": "missing"},
            blocking=True,
            return_response=True,
        )
