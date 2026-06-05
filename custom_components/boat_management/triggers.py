"""Trigger engine (pure).

Triggers select existing catalogue tasks in response to operational events;
they never invent arbitrary tasks (AGENTS.md). Matching and deduplication are
pure functions so they can be exhaustively unit-tested. The engine produces a
plan (what *would* be created and what is skipped) which supports dry-run
before any state is written.

Deduplication key (DESIGN.md):

    catalogue_task_id + trigger_source + trigger_key + operational_context_id
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .const import ACTIVE_WORK_STATUSES, TriggerSource, WorkItemStatus
from .models import TaskCatalogueItem, TriggerRule, WorkItem

#: Sources that compare a numeric reading against a rule threshold.
_THRESHOLD_SOURCES = frozenset(
    {
        TriggerSource.ENGINE_HOURS,
        TriggerSource.METER_THRESHOLD,
    }
)


@dataclass(frozen=True, slots=True)
class TriggerEvent:
    """An operational event evaluated against catalogue trigger rules."""

    source: str
    key: str | None = None
    context_id: str | None = None
    value: float | None = None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PlannedWork:
    """A catalogue task selected by a trigger, with its dedup key."""

    catalogue_task_id: str
    dedup_key: str
    trigger_source: str
    trigger_key: str | None
    operational_context_id: str | None


@dataclass(frozen=True, slots=True)
class TriggerPlan:
    """Result of evaluating a trigger event: what to create vs. skip."""

    to_create: list[PlannedWork] = field(default_factory=list)
    skipped_existing: list[PlannedWork] = field(default_factory=list)

    @property
    def created_count(self) -> int:
        return len(self.to_create)

    @property
    def skipped_count(self) -> int:
        return len(self.skipped_existing)


def dedup_key(
    catalogue_task_id: str,
    source: str,
    key: str | None,
    context_id: str | None,
) -> str:
    """Build the canonical deduplication key for a triggered work item."""
    return "|".join(
        [
            catalogue_task_id,
            str(source),
            key or "",
            context_id or "",
        ]
    )


def _rule_matches(rule: TriggerRule, event: TriggerEvent) -> bool:
    """Return True if ``rule`` is satisfied by ``event``.

    A rule matches when the source matches and, where a rule ``key`` is set, it
    equals the event key. Threshold sources additionally require the event
    ``value`` to meet or exceed the rule threshold.
    """
    if rule.source != event.source:
        return False
    if rule.key is not None and rule.key != event.key:
        return False
    return not (
        event.source in _THRESHOLD_SOURCES
        and rule.threshold is not None
        and (event.value is None or event.value < rule.threshold)
    )


def match_catalogue_tasks(
    event: TriggerEvent,
    catalogue: Mapping[str, TaskCatalogueItem],
) -> list[TaskCatalogueItem]:
    """Return active catalogue tasks whose trigger rules match ``event``.

    Results are sorted by id for deterministic output.
    """
    matched: list[TaskCatalogueItem] = []
    for task in catalogue.values():
        if not task.active:
            continue
        if any(_rule_matches(rule, event) for rule in task.trigger_rules):
            matched.append(task)
    matched.sort(key=lambda t: t.id)
    return matched


def existing_dedup_keys(work_items: Mapping[str, WorkItem]) -> set[str]:
    """Collect dedup keys for all currently open (active) work items."""
    keys: set[str] = set()
    for wi in work_items.values():
        if WorkItemStatus(wi.status) not in ACTIVE_WORK_STATUSES:
            continue
        keys.add(
            dedup_key(
                wi.catalogue_task_id,
                wi.trigger_source,
                wi.trigger_key,
                wi.operational_context_id,
            )
        )
    return keys


def plan_triggered_work(
    event: TriggerEvent,
    catalogue: Mapping[str, TaskCatalogueItem],
    work_items: Mapping[str, WorkItem],
) -> TriggerPlan:
    """Compute the work that ``event`` would create, deduplicated.

    Pure: callers can present this as a dry-run before persisting anything.
    """
    open_keys = existing_dedup_keys(work_items)
    to_create: list[PlannedWork] = []
    skipped: list[PlannedWork] = []

    for task in match_catalogue_tasks(event, catalogue):
        key = dedup_key(task.id, event.source, event.key, event.context_id)
        planned = PlannedWork(
            catalogue_task_id=task.id,
            dedup_key=key,
            trigger_source=event.source,
            trigger_key=event.key,
            operational_context_id=event.context_id,
        )
        if key in open_keys:
            skipped.append(planned)
        else:
            # Guard against duplicate creation within the same event batch.
            open_keys.add(key)
            to_create.append(planned)

    return TriggerPlan(to_create=to_create, skipped_existing=skipped)


def plan_for_task(
    catalogue_task_id: str,
    source: str,
    key: str | None,
    context_id: str | None,
    work_items: Mapping[str, WorkItem],
) -> TriggerPlan:
    """Plan a single, already-chosen catalogue task for a trigger context.

    Used when a *specific* suggestion is accepted: the catalogue matcher is
    bypassed (the task is already known) but the open-work dedup rule still
    applies, so accepting the same suggestion twice never double-creates. Pure,
    so the caller can present it as a dry-run before persisting.
    """
    key_str = dedup_key(catalogue_task_id, source, key, context_id)
    planned = PlannedWork(
        catalogue_task_id=catalogue_task_id,
        dedup_key=key_str,
        trigger_source=source,
        trigger_key=key,
        operational_context_id=context_id,
    )
    if key_str in existing_dedup_keys(work_items):
        return TriggerPlan(skipped_existing=[planned])
    return TriggerPlan(to_create=[planned])
