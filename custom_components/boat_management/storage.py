"""Storage layer for boat_management.

Wraps Home Assistant's ``Store`` helper with a typed in-memory container
(``BoatData``), an async write lock, and explicit schema versioning. Domain
logic operates on ``BoatData``; serialization to/from the persisted dict is
explicit here so future migrations stay deterministic.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY_TEMPLATE, STORAGE_VERSION
from .data import BoatData
from .migrations import migrate_to_latest

_LOGGER = logging.getLogger(__name__)

__all__ = ["BoatData", "BoatStore"]


class BoatStore:
    """Persistence manager for a single config entry's vessel data."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass,
            STORAGE_VERSION,
            STORAGE_KEY_TEMPLATE.format(entry_id=entry_id),
            private=True,
        )
        self.last_loaded_at: str | None = None
        self.last_saved_at: str | None = None
        self.last_migration_from: int | None = None

    async def async_load(self) -> dict[str, Any] | None:
        """Load and migrate the raw persisted payload.

        Returns ``None`` when there is no stored data yet (fresh install).
        Migration failures are surfaced to the caller, never silently patched.
        """
        from .timezone import utc_now

        raw = await self._store.async_load()
        self.last_loaded_at = utc_now().isoformat()
        if raw is None:
            return None
        stored_version = int(raw.get("version", 1))
        migrated, changed = migrate_to_latest(raw)
        if changed:
            self.last_migration_from = stored_version
            _LOGGER.info(
                "Migrated boat_management storage from version %s to %s",
                stored_version,
                STORAGE_VERSION,
            )
        return migrated

    async def async_save(self, data: BoatData) -> None:
        """Persist the full typed container."""
        from .timezone import utc_now

        await self._store.async_save(data.to_dict())
        self.last_saved_at = utc_now().isoformat()

    async def async_remove(self) -> None:
        await self._store.async_remove()
