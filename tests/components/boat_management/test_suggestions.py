"""Unit tests for the pure operational-intelligence suggestion engine."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from custom_components.boat_management.const import TriggerSource
from custom_components.boat_management.models import (
    InventoryItem,
    TaskCatalogueItem,
    TriggerRule,
)
from custom_components.boat_management.suggestions import (
    build_suggestions,
    calendar_due_suggestions,
    low_stock_suggestions,
    plan_trigger_application,
)
from custom_components.boat_management.timezone import utc_now
from custom_components.boat_management.validators import ValidationError
from custom_components.boat_management.work_items import create_work_item

from .helpers import make_data


def _add_inventory(
    data,
    *,
    item_id: str = "inv1",
    name: str = "Fuel filter",
    category: str | None = "filters",
    quantity: str = "1",
    reorder: str | None = "2",
) -> InventoryItem:
    item = InventoryItem(
        id=item_id,
        name=name,
        quantity=Decimal(quantity),
        category=category,
        reorder_level=None if reorder is None else Decimal(reorder),
    )
    data.inventory[item.id] = item
    return item


def _add_task(
    data,
    *,
    task_id: str = "task1",
    title: str = "Restock",
    rules=(),
    last=None,
    active: bool = True,
) -> TaskCatalogueItem:
    task = TaskCatalogueItem(
        id=task_id,
        title=title,
        trigger_rules=list(rules),
        last_completed_at_utc=last,
        active=active,
    )
    data.task_catalogue[task.id] = task
    return task


# --- Low stock --------------------------------------------------------------
def test_low_stock_matches_keyed_and_generic_rules() -> None:
    data = make_data()
    _add_inventory(data, item_id="inv1", category="filters", quantity="1", reorder="2")
    _add_task(
        data,
        task_id="t_keyed",
        title="Restock filters",
        rules=[TriggerRule(source=TriggerSource.INVENTORY.value, key="filters")],
    )
    # A keyless inventory rule matches every low-stock category (the seeded
    # "Restock low inventory" task relies on this).
    _add_task(
        data,
        task_id="t_generic",
        title="Restock low inventory",
        rules=[TriggerRule(source=TriggerSource.INVENTORY.value)],
    )

    suggestions = low_stock_suggestions(data)

    assert {s.catalogue_task_id for s in suggestions} == {"t_keyed", "t_generic"}
    keyed = next(s for s in suggestions if s.catalogue_task_id == "t_keyed")
    assert keyed.source == "inventory"
    assert keyed.key == "filters"
    assert keyed.context_id == "inv1"
    assert keyed.context_label == "Fuel filter"
    assert "reorder level 2" in keyed.reason
    assert keyed.already_open is False


def test_low_stock_ignores_healthy_and_inactive() -> None:
    data = make_data()
    # Above reorder level -> not low.
    _add_inventory(data, item_id="inv1", quantity="9", reorder="2")
    # Low but retired -> excluded.
    low = _add_inventory(data, item_id="inv2", quantity="0", reorder="2")
    low.active = False
    _add_task(data, rules=[TriggerRule(source=TriggerSource.INVENTORY.value)])

    assert low_stock_suggestions(data) == []


def test_low_stock_marks_already_open() -> None:
    data = make_data()
    _add_inventory(data, item_id="inv1", category="filters", quantity="1", reorder="2")
    _add_task(
        data,
        task_id="t1",
        rules=[TriggerRule(source=TriggerSource.INVENTORY.value, key="filters")],
    )
    # An open work item with the same dedup context must not be re-suggested.
    create_work_item(
        data,
        catalogue_task_id="t1",
        trigger_source="inventory",
        trigger_key="filters",
        operational_context_id="inv1",
    )

    suggestions = low_stock_suggestions(data)

    assert len(suggestions) == 1
    assert suggestions[0].already_open is True


# --- Calendar due -----------------------------------------------------------
def test_calendar_never_completed_is_due() -> None:
    data = make_data()
    _add_task(
        data,
        task_id="t1",
        title="Annual safety",
        rules=[TriggerRule(source=TriggerSource.CALENDAR.value, key="annual")],
        last=None,
    )

    suggestions = calendar_due_suggestions(data)

    assert len(suggestions) == 1
    assert suggestions[0].reason == "Never completed"
    assert suggestions[0].source == "calendar"
    assert suggestions[0].key == "annual"
    assert suggestions[0].context_id is None


def test_calendar_due_after_interval_elapsed() -> None:
    now = utc_now()
    data = make_data()
    _add_task(
        data,
        task_id="t1",
        rules=[TriggerRule(source=TriggerSource.CALENDAR.value, key="quarterly")],
        last=now - timedelta(days=120),
    )

    suggestions = calendar_due_suggestions(data, now=now)

    assert len(suggestions) == 1
    assert "due every 91d" in suggestions[0].reason


def test_calendar_not_due_when_recent() -> None:
    now = utc_now()
    data = make_data()
    _add_task(
        data,
        task_id="t1",
        rules=[TriggerRule(source=TriggerSource.CALENDAR.value, key="annual")],
        last=now - timedelta(days=10),
    )

    assert calendar_due_suggestions(data, now=now) == []


def test_calendar_meta_interval_overrides_named_period() -> None:
    now = utc_now()
    data = make_data()
    _add_task(
        data,
        task_id="t1",
        rules=[
            TriggerRule(
                source=TriggerSource.CALENDAR.value,
                key="custom",
                meta={"interval_days": 30},
            )
        ],
        last=now - timedelta(days=31),
    )

    suggestions = calendar_due_suggestions(data, now=now)

    assert len(suggestions) == 1
    assert "due every 30d" in suggestions[0].reason


def test_calendar_unschedulable_rule_is_skipped() -> None:
    data = make_data()
    # No named-period match and no meta override -> cannot derive a due date.
    _add_task(
        data,
        task_id="t1",
        rules=[TriggerRule(source=TriggerSource.CALENDAR.value, key="whenever")],
        last=None,
    )

    assert calendar_due_suggestions(data) == []


def test_calendar_one_suggestion_per_task() -> None:
    now = utc_now()
    data = make_data()
    _add_task(
        data,
        task_id="t1",
        rules=[
            TriggerRule(source=TriggerSource.CALENDAR.value, key="monthly"),
            TriggerRule(source=TriggerSource.CALENDAR.value, key="annual"),
        ],
        last=None,
    )

    assert len(calendar_due_suggestions(data, now=now)) == 1


# --- Aggregation ------------------------------------------------------------
def test_build_suggestions_aggregates_sorted() -> None:
    now = utc_now()
    data = make_data()
    _add_task(
        data,
        task_id="cal",
        title="Annual safety",
        rules=[TriggerRule(source=TriggerSource.CALENDAR.value, key="annual")],
        last=None,
    )
    _add_inventory(data, item_id="inv1", category="filters", quantity="0", reorder="1")
    _add_task(
        data,
        task_id="invt",
        title="Restock filters",
        rules=[TriggerRule(source=TriggerSource.INVENTORY.value, key="filters")],
    )

    suggestions = build_suggestions(data, now=now)

    assert len(suggestions) == 2
    # Deterministic order by source: "calendar" before "inventory".
    assert suggestions[0].source == "calendar"
    assert suggestions[1].source == "inventory"


# --- plan_trigger_application (two modes) -----------------------------------
def test_plan_trigger_application_suggestion_mode() -> None:
    data = make_data()
    _add_task(
        data,
        task_id="t1",
        rules=[TriggerRule(source=TriggerSource.INVENTORY.value, key="filters")],
    )

    plan = plan_trigger_application(
        data,
        source="inventory",
        catalogue_task_id="t1",
        key="filters",
        context_id="inv1",
    )

    assert plan.created_count == 1
    assert plan.to_create[0].catalogue_task_id == "t1"
    assert plan.to_create[0].trigger_key == "filters"


def test_plan_trigger_application_unknown_task_raises() -> None:
    data = make_data()
    with pytest.raises(ValidationError):
        plan_trigger_application(data, source="inventory", catalogue_task_id="nope")


def test_plan_trigger_application_archived_task_raises() -> None:
    data = make_data()
    task = _add_task(data, task_id="t1", rules=[])
    task.active = False
    with pytest.raises(ValidationError):
        plan_trigger_application(data, source="inventory", catalogue_task_id="t1")


def test_plan_trigger_application_event_mode_uses_matcher() -> None:
    data = make_data()
    _add_task(
        data,
        task_id="t1",
        title="Winterize",
        rules=[
            TriggerRule(source=TriggerSource.SEASONAL_TRANSITION.value, key="winter")
        ],
    )

    plan = plan_trigger_application(data, source="seasonal_transition", key="winter")
    assert plan.created_count == 1
    assert plan.to_create[0].catalogue_task_id == "t1"

    # No rule accepts this event -> nothing planned.
    empty = plan_trigger_application(data, source="seasonal_transition", key="spring")
    assert empty.created_count == 0
