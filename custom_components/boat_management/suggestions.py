"""Operational intelligence: derive maintenance suggestions from vessel state.

This module turns *standing* operational state into proposed work, without ever
inventing arbitrary tasks (AGENTS.md): every suggestion points at an existing,
active catalogue task. Two state-driven sources are covered here:

- **Low stock** - inventory at or below its reorder/minimum level selects
  catalogue tasks whose rules accept an ``inventory`` trigger.
- **Calendar due** - catalogue tasks with a calendar trigger rule whose
  recurrence interval has elapsed since they were last verified.

Event-driven sources (engine hours, seasonal transition, passage planning,
inspection results) are *operator actions*, not standing state, so they flow in
through :func:`plan_trigger_application` rather than being computed here.

Everything is pure over :class:`BoatData` so it is exhaustively unit-testable
and supports dry-run before any work is written. This module must not import
Home Assistant.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from .const import TriggerSource
from .data import BoatData
from .models import TriggerRule
from .timezone import utc_now
from .triggers import (
    TriggerEvent,
    TriggerPlan,
    dedup_key,
    existing_dedup_keys,
    match_catalogue_tasks,
    plan_for_task,
    plan_triggered_work,
)
from .validators import ValidationError

#: Named calendar recurrences mapped to a nominal interval in days. These are
#: deliberately approximate (a quarter is ~91 days); a rule can override with an
#: explicit ``meta.interval_days`` when precision matters.
_CALENDAR_PERIOD_DAYS: dict[str, int] = {
    "weekly": 7,
    "monthly": 30,
    "quarterly": 91,
    "biannual": 182,
    "semiannual": 182,
    "annual": 365,
    "yearly": 365,
    "biennial": 730,
}


@dataclass(frozen=True, slots=True)
class MaintenanceSuggestion:
    """A proposed work item derived from current vessel state.

    Carries exactly the trigger context needed to instantiate it
    (:attr:`catalogue_task_id` + source/key/context) plus presentation hints
    and an :attr:`already_open` flag so the panel can show, but not re-create,
    work that is already in flight.
    """

    catalogue_task_id: str
    title: str
    source: str
    key: str | None
    context_id: str | None
    context_label: str | None
    reason: str
    dedup_key: str
    already_open: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "catalogue_task_id": self.catalogue_task_id,
            "title": self.title,
            "source": self.source,
            "key": self.key,
            "context_id": self.context_id,
            "context_label": self.context_label,
            "reason": self.reason,
            "dedup_key": self.dedup_key,
            "already_open": self.already_open,
        }


def _interval_days(rule: TriggerRule) -> int | None:
    """Resolve a calendar rule's recurrence in days, or None if unschedulable.

    An explicit ``meta.interval_days`` wins; otherwise the named period key is
    looked up. A rule with neither cannot be turned into a due date and is
    skipped rather than guessed.
    """
    meta_days = rule.meta.get("interval_days") if rule.meta else None
    if meta_days is not None:
        try:
            return int(meta_days)
        except (TypeError, ValueError):
            return None
    if rule.key and rule.key in _CALENDAR_PERIOD_DAYS:
        return _CALENDAR_PERIOD_DAYS[rule.key]
    return None


def low_stock_suggestions(
    data: BoatData, *, open_keys: set[str] | None = None
) -> list[MaintenanceSuggestion]:
    """Suggest restock work for inventory at/below its reorder level.

    Each low-stock item is modelled as an ``inventory`` trigger event keyed by
    the item's category (so a catalogue task can target a category, while a
    generic rule still matches everything) and contextualized by the item id
    (so two low items never collapse to one work item).
    """
    keys = existing_dedup_keys(data.work_items) if open_keys is None else open_keys
    out: list[MaintenanceSuggestion] = []
    for item in data.inventory.values():
        if not item.active or not item.is_low_stock():
            continue
        threshold = (
            item.reorder_level if item.reorder_level is not None else item.minimum_stock
        )
        event = TriggerEvent(
            source=TriggerSource.INVENTORY.value,
            key=item.category,
            context_id=item.id,
            value=float(item.quantity),
        )
        reason = f"Stock {item.quantity} <= reorder level {threshold}"
        for task in match_catalogue_tasks(event, data.task_catalogue):
            dk = dedup_key(task.id, event.source, event.key, event.context_id)
            out.append(
                MaintenanceSuggestion(
                    catalogue_task_id=task.id,
                    title=task.title,
                    source=event.source,
                    key=event.key,
                    context_id=event.context_id,
                    context_label=item.name,
                    reason=reason,
                    dedup_key=dk,
                    already_open=dk in keys,
                )
            )
    return out


def calendar_due_suggestions(
    data: BoatData,
    *,
    now: datetime | None = None,
    open_keys: set[str] | None = None,
) -> list[MaintenanceSuggestion]:
    """Suggest catalogue tasks whose calendar recurrence has come due.

    A task is due when it has never been verified, or when its last verified
    completion plus the rule's recurrence interval is on or before ``now``. One
    suggestion per task (the first due calendar rule) keeps the list quiet.
    """
    moment = now or utc_now()
    keys = existing_dedup_keys(data.work_items) if open_keys is None else open_keys
    out: list[MaintenanceSuggestion] = []
    for task in data.task_catalogue.values():
        if not task.active:
            continue
        for rule in task.trigger_rules:
            if rule.source != TriggerSource.CALENDAR.value:
                continue
            interval = _interval_days(rule)
            if interval is None:
                continue
            baseline = task.last_completed_at_utc
            if baseline is None:
                reason = "Never completed"
            elif baseline + timedelta(days=interval) <= moment:
                reason = (
                    f"Last done {baseline.date().isoformat()}; due every {interval}d"
                )
            else:
                continue
            dk = dedup_key(task.id, rule.source, rule.key, None)
            out.append(
                MaintenanceSuggestion(
                    catalogue_task_id=task.id,
                    title=task.title,
                    source=rule.source,
                    key=rule.key,
                    context_id=None,
                    context_label=None,
                    reason=reason,
                    dedup_key=dk,
                    already_open=dk in keys,
                )
            )
            break  # one suggestion per task even with several calendar rules
    return out


def build_suggestions(
    data: BoatData, *, now: datetime | None = None
) -> list[MaintenanceSuggestion]:
    """Aggregate all state-driven suggestions, deterministically ordered."""
    open_keys = existing_dedup_keys(data.work_items)
    suggestions = [
        *calendar_due_suggestions(data, now=now, open_keys=open_keys),
        *low_stock_suggestions(data, open_keys=open_keys),
    ]
    suggestions.sort(
        key=lambda s: (s.source, s.title, s.context_label or "", s.catalogue_task_id)
    )
    return suggestions


def plan_trigger_application(
    data: BoatData,
    *,
    source: str,
    catalogue_task_id: str | None = None,
    key: str | None = None,
    context_id: str | None = None,
    value: float | None = None,
) -> TriggerPlan:
    """Plan the work an applied trigger would create (pure dry-run core).

    Two modes share one entry point:

    - **Suggestion mode** (``catalogue_task_id`` given): create exactly that
      task for the context, bypassing the matcher. The task must still exist and
      be active so a stale panel cannot resurrect an archived task.
    - **Event mode** (no task id): an operator fires an event and the catalogue
      matcher selects every task whose rules accept it.

    Both deduplicate against open work. Callers persist via the coordinator.
    """
    if catalogue_task_id is not None:
        task = data.task_catalogue.get(catalogue_task_id)
        if task is None:
            raise ValidationError(f"Unknown catalogue task '{catalogue_task_id}'")
        if not task.active:
            raise ValidationError(
                f"Catalogue task '{catalogue_task_id}' is archived and cannot be "
                "instantiated"
            )
        return plan_for_task(
            catalogue_task_id, source, key, context_id, data.work_items
        )
    event = TriggerEvent(source=source, key=key, context_id=context_id, value=value)
    return plan_triggered_work(event, data.task_catalogue, data.work_items)
