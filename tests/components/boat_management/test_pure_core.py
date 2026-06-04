"""Unit tests for pure timezone helpers and transition/migration logic."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from custom_components.boat_management.const import STORAGE_VERSION, WorkItemStatus
from custom_components.boat_management.migrations import (
    MigrationError,
    migrate_to_latest,
)
from custom_components.boat_management.timezone import (
    EventTimestamp,
    is_valid_timezone,
    parse_utc,
    to_local_iso,
    to_utc_iso,
    validate_timezone,
)
from custom_components.boat_management.transitions import (
    TransitionError,
    assert_transition,
    can_transition,
)


def test_valid_and_invalid_timezones() -> None:
    assert is_valid_timezone("Europe/Paris")
    assert is_valid_timezone("America/New_York")
    assert not is_valid_timezone("UTC+2")
    assert not is_valid_timezone("")
    assert not is_valid_timezone(None)


def test_validate_timezone_raises() -> None:
    assert validate_timezone("UTC") == "UTC"
    with pytest.raises(ValueError, match="Invalid timezone"):
        validate_timezone("Nowhere/Atlantis")


def test_utc_local_roundtrip_preserves_instant() -> None:
    instant = datetime(2026, 6, 4, 10, 30, tzinfo=UTC)
    iso = to_utc_iso(instant)
    assert parse_utc(iso) == instant
    # Local rendering in Paris is +02:00 in summer but same instant.
    local = to_local_iso(instant, "Europe/Paris")
    assert local.endswith("+02:00")
    assert parse_utc(local) == instant


def test_event_timestamp_capture_preserves_timezone() -> None:
    instant = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    stamp = EventTimestamp.capture("Europe/Paris", now=instant)
    assert stamp.utc == instant
    assert stamp.timezone_name == "Europe/Paris"
    # January in Paris is +01:00.
    assert stamp.local_iso.endswith("+01:00")


def test_transition_matrix_canonical_flow() -> None:
    assert can_transition(WorkItemStatus.TODO, WorkItemStatus.IN_PROGRESS)
    assert can_transition(WorkItemStatus.IN_PROGRESS, WorkItemStatus.REVIEW)
    assert can_transition(WorkItemStatus.REVIEW, WorkItemStatus.DONE)


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (WorkItemStatus.DONE, WorkItemStatus.TODO),
        (WorkItemStatus.CANCELLED, WorkItemStatus.DONE),
        (WorkItemStatus.TODO, WorkItemStatus.DONE),
        (WorkItemStatus.TODO, WorkItemStatus.REVIEW),
    ],
)
def test_transition_disallowed(current, target) -> None:
    assert not can_transition(current, target)
    with pytest.raises(TransitionError):
        assert_transition(current, target)


def test_transition_unknown_status() -> None:
    with pytest.raises(TransitionError):
        assert_transition("nonsense", WorkItemStatus.DONE)


def test_migration_noop_adds_collections() -> None:
    raw = {"version": STORAGE_VERSION, "vessel": {"id": "v"}}
    migrated, changed = migrate_to_latest(raw)
    assert migrated["version"] == STORAGE_VERSION
    assert "equipment" in migrated
    assert changed is True  # collections were added


def test_migration_rejects_future_version() -> None:
    with pytest.raises(MigrationError):
        migrate_to_latest({"version": STORAGE_VERSION + 5, "vessel": {}})
