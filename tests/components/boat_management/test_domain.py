"""Unit tests for domain operations over BoatData (no Home Assistant)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from custom_components.boat_management.const import (
    CrewRole,
    TimezoneSource,
    WorkItemStatus,
)
from custom_components.boat_management.equipment import (
    create_equipment,
    equipment_due_for_maintenance,
    retire_equipment,
)
from custom_components.boat_management.inventory import (
    adjust_inventory_quantity,
    consume_inventory,
    create_inventory_item,
)
from custom_components.boat_management.logbook import (
    amend_log_entry,
    verify_work_item,
)
from custom_components.boat_management.models import CrewMember
from custom_components.boat_management.task_catalogue import create_catalogue_task
from custom_components.boat_management.transitions import TransitionError
from custom_components.boat_management.validators import ValidationError
from custom_components.boat_management.vessel import set_vessel_timezone
from custom_components.boat_management.work_items import (
    create_work_item,
    reopen_work_item,
    start_work_item,
    submit_for_review,
)

from .helpers import make_data


def _crew(data, role=CrewRole.SKIPPER.value):
    member = CrewMember(id="crew1", name="Skipper", role=role)
    data.crew[member.id] = member
    return member


def _ready_for_review(data, *, with_inventory=None):
    task = create_catalogue_task(data, title="Check oil")
    wi = create_work_item(data, catalogue_task_id=task.id)
    start_work_item(data, work_item_id=wi.id)
    submit_for_review(
        data,
        work_item_id=wi.id,
        inventory_used=with_inventory,
    )
    return wi


# --- Equipment / Inventory --------------------------------------------------
def test_create_equipment_validates_system() -> None:
    data = make_data()
    with pytest.raises(ValidationError):
        create_equipment(data, name="Engine", system_id="missing")


def test_retire_equipment_is_soft() -> None:
    data = make_data()
    eq = create_equipment(data, name="Windlass")
    retire_equipment(data, equipment_id=eq.id)
    assert data.equipment[eq.id].active is False
    assert data.equipment[eq.id].retired_date is not None


def test_consume_inventory_rejects_oversupply() -> None:
    data = make_data()
    item = create_inventory_item(data, name="Oil filter", quantity="2")
    with pytest.raises(ValidationError):
        consume_inventory(data, inventory_id=item.id, quantity="5")
    consume_inventory(data, inventory_id=item.id, quantity="1")
    assert data.inventory[item.id].quantity == Decimal("1")


def test_adjust_inventory_cannot_go_negative() -> None:
    data = make_data()
    item = create_inventory_item(data, name="Impeller", quantity="1")
    with pytest.raises(ValidationError):
        adjust_inventory_quantity(data, inventory_id=item.id, delta="-5")


# --- Equipment due maintenance ----------------------------------------------
def test_equipment_without_interval_never_due() -> None:
    data = make_data()
    create_equipment(data, name="Bilge pump")
    assert equipment_due_for_maintenance(data) == []


def test_equipment_with_interval_and_no_history_is_due() -> None:
    data = make_data()
    eq = create_equipment(data, name="Anode", maintenance_interval_days=180)
    assert eq.maintenance_interval_days == 180
    assert eq.id in equipment_due_for_maintenance(data)


def test_equipment_due_from_old_commissioned_date() -> None:
    data = make_data()
    eq = create_equipment(
        data,
        name="Impeller",
        maintenance_interval_days=365,
        commissioned_date="2000-01-01",
    )
    assert eq.id in equipment_due_for_maintenance(data)


def test_equipment_not_due_after_recent_maintenance() -> None:
    data = make_data()
    _crew(data)
    eq = create_equipment(data, name="Engine", maintenance_interval_days=365)
    task = create_catalogue_task(data, title="Service engine", equipment_refs=[eq.id])
    wi = create_work_item(data, catalogue_task_id=task.id)
    start_work_item(data, work_item_id=wi.id)
    submit_for_review(data, work_item_id=wi.id)
    verify_work_item(
        data, work_item_id=wi.id, verified_by="crew1", consume_inventory=False
    )
    # Just serviced; next due is a year out.
    assert eq.id not in equipment_due_for_maintenance(data)


def test_retired_equipment_not_due() -> None:
    data = make_data()
    eq = create_equipment(data, name="Old pump", maintenance_interval_days=30)
    retire_equipment(data, equipment_id=eq.id)
    assert eq.id not in equipment_due_for_maintenance(data)


# --- Work item lifecycle ----------------------------------------------------
def test_work_item_requires_catalogue_task() -> None:
    data = make_data()
    with pytest.raises(ValidationError):
        create_work_item(data, catalogue_task_id="nope")


def test_lifecycle_happy_path_creates_log_entry() -> None:
    data = make_data()
    _crew(data)
    wi = _ready_for_review(data)
    assert data.work_items[wi.id].status == WorkItemStatus.REVIEW.value

    entry = verify_work_item(
        data, work_item_id=wi.id, verified_by="crew1", consume_inventory=False
    )
    assert data.work_items[wi.id].status == WorkItemStatus.DONE.value
    assert entry.id in data.maintenance_log
    assert entry.verified_by == "crew1"


def test_verify_requires_verifier_role() -> None:
    data = make_data()
    _crew(data, role=CrewRole.CREW.value)
    wi = _ready_for_review(data)
    with pytest.raises(ValidationError, match="not permitted"):
        verify_work_item(data, work_item_id=wi.id, verified_by="crew1")


def test_verify_consumes_inventory() -> None:
    data = make_data()
    _crew(data)
    item = create_inventory_item(data, name="Oil", quantity="5", unit="L")
    wi = _ready_for_review(
        data,
        with_inventory=[{"inventory_id": item.id, "quantity": "2"}],
    )
    verify_work_item(
        data, work_item_id=wi.id, verified_by="crew1", consume_inventory=True
    )
    assert data.inventory[item.id].quantity == Decimal("3")


def test_cannot_verify_from_todo() -> None:
    data = make_data()
    _crew(data)
    task = create_catalogue_task(data, title="x")
    wi = create_work_item(data, catalogue_task_id=task.id)
    with pytest.raises(TransitionError):
        verify_work_item(data, work_item_id=wi.id, verified_by="crew1")


def test_reopen_does_not_delete_log_entry() -> None:
    data = make_data()
    _crew(data)
    wi = _ready_for_review(data)
    entry = verify_work_item(
        data, work_item_id=wi.id, verified_by="crew1", consume_inventory=False
    )
    corrective = reopen_work_item(data, work_item_id=wi.id)

    # Original log entry survives; a new corrective work item exists.
    assert entry.id in data.maintenance_log
    assert corrective.id in data.work_items
    assert corrective.status == WorkItemStatus.TODO.value
    assert data.work_items[wi.id].status == WorkItemStatus.DONE.value


def test_amend_log_entry_is_append_only() -> None:
    data = make_data()
    _crew(data)
    wi = _ready_for_review(data)
    entry = verify_work_item(
        data, work_item_id=wi.id, verified_by="crew1", consume_inventory=False
    )
    amend_log_entry(data, log_entry_id=entry.id, note="Corrected torque value")
    assert len(data.maintenance_log[entry.id].amendments) == 1


# --- Timezone ---------------------------------------------------------------
def test_set_vessel_timezone_does_not_rewrite_history() -> None:
    data = make_data(timezone="Europe/Paris")
    _crew(data)
    wi = _ready_for_review(data)
    entry = verify_work_item(
        data, work_item_id=wi.id, verified_by="crew1", consume_inventory=False
    )
    original_local = entry.completed_at_local
    original_tz = entry.timezone_at_completion

    set_vessel_timezone(
        data,
        timezone_name="America/New_York",
        source=TimezoneSource.GPS_POSITION.value,
    )
    assert data.vessel.current_timezone == "America/New_York"
    # Historical record untouched.
    assert data.maintenance_log[entry.id].completed_at_local == original_local
    assert data.maintenance_log[entry.id].timezone_at_completion == original_tz


def test_set_invalid_timezone_rejected() -> None:
    data = make_data()
    with pytest.raises(ValueError, match="Invalid timezone"):
        set_vessel_timezone(data, timezone_name="UTC+2")
