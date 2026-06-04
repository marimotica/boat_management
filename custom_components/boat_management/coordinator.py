"""Runtime coordinator for a single managed vessel.

The coordinator owns the live :class:`BoatData`, the persistence store, and a
write lock. It is the only place that mutates-then-persists, ensuring service
calls cannot race corrupt storage (AGENTS.md reliability rules). Domain logic
stays in the pure modules; the coordinator just orchestrates lock -> run ->
save -> notify.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import (
    CONF_CURRENT_TIMEZONE,
    CONF_DEFAULT_TIMEZONE,
    CONF_HOME_PORT,
    CONF_UNITS,
    CONF_VESSEL_ID,
    CONF_VESSEL_NAME,
    DEFAULT_UNITS,
    TimezoneSource,
)
from .data import BoatData
from .models import Vessel, new_id
from .storage import BoatStore
from .timezone import utc_now

_LOGGER = logging.getLogger(__name__)


def _build_initial_vessel(entry: ConfigEntry, ha_timezone: str) -> Vessel:
    """Create the root vessel object from config entry data/options.

    The vessel timezone defaults to Home Assistant's configured timezone
    (DESIGN.md Timezone Design): Home Assistant is expected to run onboard, so
    its timezone is the live operational default until a manual or GPS-derived
    override is set.
    """
    merged: dict[str, Any] = {**entry.data, **entry.options}
    default_tz = merged.get(CONF_DEFAULT_TIMEZONE) or ha_timezone
    current_tz = merged.get(CONF_CURRENT_TIMEZONE) or default_tz
    return Vessel(
        id=merged.get(CONF_VESSEL_ID) or new_id("vessel"),
        name=merged.get(CONF_VESSEL_NAME) or "Vessel",
        default_timezone=default_tz,
        current_timezone=current_tz,
        timezone_source=TimezoneSource.MANUAL.value,
        timezone_updated_at_utc=utc_now(),
        home_port=merged.get(CONF_HOME_PORT),
        units=dict(merged.get(CONF_UNITS) or DEFAULT_UNITS),
    )


class BoatCoordinator:
    """Owns and persists one vessel's state; notifies entity listeners."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        store: BoatStore,
        data: BoatData,
    ) -> None:
        self.hass = hass
        self.entry = entry
        self.store = store
        self.data = data
        self._lock = asyncio.Lock()
        self._listeners: list[Callable[[], None]] = []
        self.last_trigger_run: str | None = None

    @classmethod
    async def async_create(
        cls, hass: HomeAssistant, entry: ConfigEntry
    ) -> BoatCoordinator:
        """Load (or initialize) persisted state for ``entry``."""
        store = BoatStore(hass, entry.entry_id)
        raw = await store.async_load()
        # Home Assistant runs onboard, so its configured timezone is the live
        # operational default whenever the vessel has no explicit override.
        ha_timezone = hass.config.time_zone or "UTC"
        if raw is None:
            data = BoatData(vessel=_build_initial_vessel(entry, ha_timezone))
            await store.async_save(data)
            _LOGGER.info(
                "Initialized new boat_management storage for vessel '%s'",
                data.vessel.name,
            )
        else:
            data = BoatData.from_dict(raw)
            # Backfill so the active timezone is always resolvable as
            # ``vessel.current_timezone or hass.config.time_zone``.
            if not data.vessel.current_timezone:
                data.vessel.current_timezone = ha_timezone
            if not data.vessel.default_timezone:
                data.vessel.default_timezone = ha_timezone
        return cls(hass, entry, store, data)

    @property
    def active_timezone(self) -> str:
        """Resolve the operational timezone for new events.

        Per DESIGN.md, a vessel override is authoritative once set; otherwise
        Home Assistant's configured timezone (it runs onboard) is the default.
        """
        return self.data.vessel.current_timezone or self.hass.config.time_zone or "UTC"

    @callback
    def async_add_listener(
        self, update_callback: Callable[[], None]
    ) -> Callable[[], None]:
        """Register an entity update callback; returns an unsubscribe."""
        self._listeners.append(update_callback)

        @callback
        def _unsub() -> None:
            if update_callback in self._listeners:
                self._listeners.remove(update_callback)

        return _unsub

    @callback
    def async_notify(self) -> None:
        """Notify all registered entity listeners of a state change."""
        for update_callback in list(self._listeners):
            update_callback()

    async def async_execute(self, func: Callable[..., Any], /, **kwargs: Any) -> Any:
        """Run a pure domain operation under lock, persist, then notify.

        ``func`` receives the live :class:`BoatData` as its first positional
        argument plus ``kwargs``. It must be synchronous and pure (it may raise
        ``ValidationError``/``TransitionError``). On any exception the store is
        not written, preserving consistency.
        """
        async with self._lock:
            result = func(self.data, **kwargs)
            await self.store.async_save(self.data)
        self.async_notify()
        return result

    async def async_save(self) -> None:
        """Persist current state (used by import/replace paths)."""
        async with self._lock:
            await self.store.async_save(self.data)
        self.async_notify()

    @callback
    def mark_trigger_run(self) -> None:
        self.last_trigger_run = utc_now().isoformat()
