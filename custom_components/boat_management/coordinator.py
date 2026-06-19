"""Runtime coordinator for a single managed vessel.

The coordinator owns the live :class:`BoatData`, the persistence store, and a
write lock. It is the only place that mutates-then-persists, ensuring service
calls cannot race corrupt storage (AGENTS.md reliability rules). Domain logic
stays in the pure modules; the coordinator just orchestrates lock -> run ->
save -> notify.

Timezone policy: the vessel timezone always mirrors Home Assistant's configured
timezone. On startup the coordinator sets ``vessel.current_timezone`` from
``hass.config.time_zone``; when HA's timezone changes (``EVENT_CORE_CONFIG_UPDATE``)
the coordinator syncs it automatically and writes an audit event.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_CORE_CONFIG_UPDATE
from homeassistant.core import Event, HomeAssistant, callback

from .const import (
    CONF_HOME_PORT,
    CONF_UNITS,
    CONF_VESSEL_ID,
    CONF_VESSEL_NAME,
    DEFAULT_UNITS,
)
from . import vessel as vessel_ops
from .data import BoatData
from .models import Vessel, new_id
from .storage import BoatStore
from .timezone import utc_now

_LOGGER = logging.getLogger(__name__)


def _build_initial_vessel(entry: ConfigEntry, ha_timezone: str) -> Vessel:
    """Create the root vessel object from config entry data.

    The vessel timezone is always the HA-configured timezone; there is no
    separate vessel-level timezone override.
    """
    merged: dict[str, Any] = {**entry.data, **entry.options}
    return Vessel(
        id=merged.get(CONF_VESSEL_ID) or new_id("vessel"),
        name=merged.get(CONF_VESSEL_NAME) or "Vessel",
        current_timezone=ha_timezone,
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
        # HA runs onboard: its configured timezone is the canonical vessel timezone.
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
            # Always sync to the current HA timezone on load, overwriting any
            # stale stored value. This is intentional: HA timezone is truth.
            data.vessel.current_timezone = ha_timezone
        return cls(hass, entry, store, data)

    @property
    def active_timezone(self) -> str:
        """Resolve the operational timezone for new events.

        ``vessel.current_timezone`` is kept in sync with HA's timezone by the
        coordinator; this property falls back to HA's live value as a defensive
        guard in case the field is somehow empty.
        """
        return self.data.vessel.current_timezone or self.hass.config.time_zone or "UTC"

    def async_subscribe_ha_timezone(self) -> Callable[[], None]:
        """Subscribe to HA timezone changes. Returns an unsubscribe callable.

        Register the returned callable with ``entry.async_on_unload`` so the
        subscription is cleaned up when the entry is unloaded.
        """

        @callback
        def _on_ha_config_update(event: Event) -> None:  # noqa: ARG001
            new_tz = self.hass.config.time_zone or "UTC"
            if new_tz != self.data.vessel.current_timezone:
                self.hass.async_create_task(self._async_sync_ha_timezone(new_tz))

        return self.hass.bus.async_listen(EVENT_CORE_CONFIG_UPDATE, _on_ha_config_update)

    async def _async_sync_ha_timezone(self, new_tz: str) -> None:
        """Persist a timezone change that originated from HA's configuration."""
        _LOGGER.debug(
            "Syncing vessel timezone to HA timezone: %s → %s",
            self.data.vessel.current_timezone,
            new_tz,
        )
        await self.async_execute(vessel_ops.sync_ha_timezone, new_tz=new_tz)

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
