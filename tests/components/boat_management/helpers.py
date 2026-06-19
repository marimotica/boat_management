"""Shared helpers for boat_management tests."""

from __future__ import annotations

from custom_components.boat_management.data import BoatData
from custom_components.boat_management.models import Vessel


def make_data(timezone: str = "Europe/Paris") -> BoatData:
    """Build an empty BoatData with a valid vessel for unit tests."""
    return BoatData(
        vessel=Vessel(
            id="vessel_test",
            name="Test Vessel",
            current_timezone=timezone,
        )
    )
