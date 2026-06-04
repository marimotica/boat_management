"""Unit tests for the pure trigger engine."""

from __future__ import annotations

from custom_components.boat_management.models import TaskCatalogueItem, TriggerRule
from custom_components.boat_management.triggers import (
    TriggerEvent,
    dedup_key,
    plan_triggered_work,
)
from custom_components.boat_management.work_items import create_work_item

from .helpers import make_data


def _catalogue_with_trigger(source: str, **rule_kwargs) -> dict:
    task = TaskCatalogueItem(
        id="task1",
        title="Winterize freshwater",
        trigger_rules=[TriggerRule(source=source, **rule_kwargs)],
    )
    return {task.id: task}


def test_match_by_source_and_key() -> None:
    catalogue = _catalogue_with_trigger("seasonal_transition", key="winter_layup")
    event = TriggerEvent(source="seasonal_transition", key="winter_layup")
    plan = plan_triggered_work(event, catalogue, {})
    assert plan.created_count == 1
    assert plan.to_create[0].catalogue_task_id == "task1"


def test_no_match_wrong_key() -> None:
    catalogue = _catalogue_with_trigger("seasonal_transition", key="winter_layup")
    event = TriggerEvent(source="seasonal_transition", key="spring")
    plan = plan_triggered_work(event, catalogue, {})
    assert plan.created_count == 0


def test_threshold_trigger() -> None:
    catalogue = _catalogue_with_trigger("engine_hours", threshold=250.0)
    below = TriggerEvent(source="engine_hours", value=100.0)
    assert plan_triggered_work(below, catalogue, {}).created_count == 0
    at = TriggerEvent(source="engine_hours", value=250.0)
    assert plan_triggered_work(at, catalogue, {}).created_count == 1


def test_inactive_task_not_matched() -> None:
    catalogue = _catalogue_with_trigger("manual")
    catalogue["task1"].active = False
    plan = plan_triggered_work(TriggerEvent(source="manual"), catalogue, {})
    assert plan.created_count == 0


def test_deduplication_against_open_work() -> None:
    data = make_data()
    catalogue = _catalogue_with_trigger("seasonal_transition", key="winter_layup")
    data.task_catalogue.update(catalogue)
    # Create an existing open work item matching the dedup key.
    create_work_item(
        data,
        catalogue_task_id="task1",
        trigger_source="seasonal_transition",
        trigger_key="winter_layup",
        operational_context_id="ctx1",
    )
    event = TriggerEvent(
        source="seasonal_transition", key="winter_layup", context_id="ctx1"
    )
    plan = plan_triggered_work(event, data.task_catalogue, data.work_items)
    assert plan.created_count == 0
    assert plan.skipped_count == 1


def test_dedup_key_stable() -> None:
    assert dedup_key("t", "manual", "k", "c") == "t|manual|k|c"
    assert dedup_key("t", "manual", None, None) == "t|manual||"
