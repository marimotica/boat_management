"""Shared helpers for boat_management tests."""

from __future__ import annotations

from custom_components.boat_management.data import BoatData
from custom_components.boat_management.models import Vessel
from custom_components.boat_management.timezone import utc_now


def make_data(timezone: str = "Europe/Paris") -> BoatData:
    """Build an empty BoatData with a valid vessel for unit tests."""
    return BoatData(
        vessel=Vessel(
            id="vessel_test",
            name="Test Vessel",
            default_timezone=timezone,
            current_timezone=timezone,
            timezone_updated_at_utc=utc_now(),
        )
    )
