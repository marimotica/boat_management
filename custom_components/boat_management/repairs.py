"""Repairs for persistent, user-actionable invalid state.

Repairs surface persisted problems (broken references, negative stock, invalid
vessel timezone, log entries missing historical timezone) so a skipper can fix
them from the UI rather than via SSH. Issues are recreated/cleared each scan so
they reflect current state.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .const import (
    DOMAIN,
    ISSUE_INVALID_TIMEZONE,
)
from .coordinator import BoatCoordinator
from .timezone import is_valid_timezone
from .validators import (
    check_equipment_references,
    check_inventory_quantities,
    check_log_entry_timezones,
    check_media_references,
    check_work_item_references,
)


@callback
def async_evaluate_repairs(hass: HomeAssistant, coordinator: BoatCoordinator) -> None:
    """Scan vessel state and (re)create or clear repair issues."""
    data = coordinator.data
    entry_id = coordinator.entry.entry_id

    active_issue_ids: set[str] = set()

    # Invalid vessel timezone.
    if not is_valid_timezone(data.vessel.current_timezone):
        issue_id = f"{ISSUE_INVALID_TIMEZONE}_{entry_id}"
        active_issue_ids.add(issue_id)
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            severity=ir.IssueSeverity.ERROR,
            translation_key=ISSUE_INVALID_TIMEZONE,
            translation_placeholders={"timezone": data.vessel.current_timezone},
        )

    problems = []
    problems += check_equipment_references(data.equipment, data.systems, data.inventory)
    problems += check_inventory_quantities(data.inventory)
    problems += check_work_item_references(data.work_items, data.task_catalogue)
    problems += check_log_entry_timezones(data.maintenance_log)
    problems += check_media_references(data.equipment, data.inventory, data.documents)

    for problem in problems:
        issue_id = f"{problem.issue_type}_{problem.object_id}"
        active_issue_ids.add(issue_id)
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=problem.issue_type,
            translation_placeholders={
                "object_id": problem.object_id,
                "detail": problem.detail,
                "missing_ref": problem.missing_ref or "",
            },
        )

    # Clear any of our previously-created issues that no longer apply. All
    # issues registered under DOMAIN are owned by this integration.
    issue_reg = ir.async_get(hass)
    for issue in list(issue_reg.issues.values()):
        if issue.domain != DOMAIN:
            continue
        if issue.issue_id not in active_issue_ids:
            ir.async_delete_issue(hass, DOMAIN, issue.issue_id)


async def async_setup_entry_repairs(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Run a repair scan for an entry (called after setup/changes)."""
    coordinator: BoatCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_evaluate_repairs(hass, coordinator)
