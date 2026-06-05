"""Unit tests for the seed catalogue (pure, no Home Assistant)."""

from __future__ import annotations

from custom_components.boat_management.seed import (
    DEFAULT_CATALOGUE_TASKS,
    DEFAULT_SYSTEMS,
    apply_seed_catalogue,
)
from custom_components.boat_management.systems import create_system
from custom_components.boat_management.task_catalogue import create_catalogue_task

from .helpers import make_data


def test_seed_populates_systems_and_tasks() -> None:
    data = make_data()
    report = apply_seed_catalogue(data)

    assert not report.dry_run
    assert report.changed
    assert len(data.systems) == len(DEFAULT_SYSTEMS)
    assert len(data.task_catalogue) == len(DEFAULT_CATALOGUE_TASKS)
    assert len(report.systems_added) == len(DEFAULT_SYSTEMS)
    assert len(report.tasks_added) == len(DEFAULT_CATALOGUE_TASKS)


def test_seed_tasks_reference_seeded_systems() -> None:
    data = make_data()
    apply_seed_catalogue(data)

    system_ids = set(data.systems)
    linked = 0
    for task in data.task_catalogue.values():
        for sid in task.system_refs:
            assert sid in system_ids
            linked += 1
    # Most curated tasks reference exactly one system; a few (e.g. the
    # system-less restock task) intentionally reference none, so the expected
    # link count is derived from the specs rather than the task total.
    expected = sum(1 for spec in DEFAULT_CATALOGUE_TASKS if spec.get("system"))
    assert linked == expected


def test_seed_is_idempotent() -> None:
    data = make_data()
    apply_seed_catalogue(data)
    second = apply_seed_catalogue(data)

    assert not second.changed
    assert second.systems_added == []
    assert second.tasks_added == []
    assert len(second.systems_skipped) == len(DEFAULT_SYSTEMS)
    assert len(second.tasks_skipped) == len(DEFAULT_CATALOGUE_TASKS)
    # No duplicates created on the second run.
    assert len(data.systems) == len(DEFAULT_SYSTEMS)
    assert len(data.task_catalogue) == len(DEFAULT_CATALOGUE_TASKS)


def test_seed_dry_run_does_not_mutate() -> None:
    data = make_data()
    report = apply_seed_catalogue(data, dry_run=True)

    assert report.dry_run
    assert report.changed
    assert len(report.systems_added) == len(DEFAULT_SYSTEMS)
    assert len(report.tasks_added) == len(DEFAULT_CATALOGUE_TASKS)
    # Nothing actually written.
    assert data.systems == {}
    assert data.task_catalogue == {}
    assert data.audit_events == {}


def test_seed_dedupes_against_existing_name_case_insensitive() -> None:
    data = make_data()
    # Pre-existing system with a differently-cased name must not be duplicated.
    create_system(data, name="propulsion")
    create_catalogue_task(data, title="CHANGE ENGINE OIL AND FILTER")

    report = apply_seed_catalogue(data)

    assert "Propulsion" in report.systems_skipped
    assert "Change engine oil and filter" in report.tasks_skipped
    propulsion_systems = [
        s for s in data.systems.values() if s.name.strip().lower() == "propulsion"
    ]
    assert len(propulsion_systems) == 1


def test_seed_writes_audit_events() -> None:
    data = make_data()
    apply_seed_catalogue(data)
    # One create audit per system + per task.
    assert len(data.audit_events) == len(DEFAULT_SYSTEMS) + len(DEFAULT_CATALOGUE_TASKS)
