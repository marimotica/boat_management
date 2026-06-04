"""Tests for repair issue creation from invalid persisted state."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.boat_management.const import DOMAIN, ISSUE_INVALID_TIMEZONE
from custom_components.boat_management.models import WorkItem
from custom_components.boat_management.repairs import async_evaluate_repairs


async def test_invalid_timezone_creates_issue(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.vessel.current_timezone = "Not/AZone"
    async_evaluate_repairs(hass, coordinator)

    issue_reg = ir.async_get(hass)
    assert any(
        i.domain == DOMAIN and ISSUE_INVALID_TIMEZONE in i.issue_id
        for i in issue_reg.issues.values()
    )


async def test_broken_work_item_reference_creates_issue(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.work_items["wi1"] = WorkItem(
        id="wi1", catalogue_task_id="ghost", title="Orphan"
    )
    async_evaluate_repairs(hass, coordinator)

    issue_reg = ir.async_get(hass)
    domain_issues = [i for i in issue_reg.issues.values() if i.domain == DOMAIN]
    assert domain_issues


async def test_issue_cleared_when_state_fixed(
    hass: HomeAssistant, setup_vessel
) -> None:
    _entry, coordinator = setup_vessel
    coordinator.data.vessel.current_timezone = "Not/AZone"
    async_evaluate_repairs(hass, coordinator)

    coordinator.data.vessel.current_timezone = "Europe/Paris"
    async_evaluate_repairs(hass, coordinator)

    issue_reg = ir.async_get(hass)
    assert not any(
        i.domain == DOMAIN and ISSUE_INVALID_TIMEZONE in i.issue_id
        for i in issue_reg.issues.values()
    )
