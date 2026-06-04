"""Config and options flow for boat_management.

Setup collects vessel identity and timezone state. Timezones are validated
against the IANA database; empty optional strings are normalized to ``None``.
The flow never requires internet access (AGENTS.md config flow rules).
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
import voluptuous as vol

from .const import (
    CONF_CONSUME_ON_VERIFY,
    CONF_CURRENT_TIMEZONE,
    CONF_DEFAULT_TIMEZONE,
    CONF_DIAGNOSTICS_VERBOSE,
    CONF_HOME_PORT,
    CONF_LOW_STOCK_CREATES_WORK,
    CONF_TRIGGER_AUTORUN,
    CONF_VESSEL_ID,
    CONF_VESSEL_NAME,
    DOMAIN,
)
from .timezone import is_valid_timezone


def _normalize(value: str | None) -> str | None:
    """Treat blank strings as unset."""
    if value is None:
        return None
    value = value.strip()
    return value or None


class BoatManagementConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial setup of a vessel."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}
        # Home Assistant is expected to run onboard, so its timezone is the
        # default vessel timezone unless the skipper overrides it (DESIGN.md).
        ha_tz = self.hass.config.time_zone or "UTC"

        if user_input is not None:
            name = _normalize(user_input.get(CONF_VESSEL_NAME))
            default_tz = _normalize(user_input.get(CONF_DEFAULT_TIMEZONE)) or ha_tz
            current_tz = _normalize(user_input.get(CONF_CURRENT_TIMEZONE)) or default_tz

            if not name:
                errors[CONF_VESSEL_NAME] = "required"
            if not is_valid_timezone(default_tz):
                errors[CONF_DEFAULT_TIMEZONE] = "invalid_timezone"
            if not is_valid_timezone(current_tz):
                errors[CONF_CURRENT_TIMEZONE] = "invalid_timezone"

            if not errors:
                data = {
                    CONF_VESSEL_NAME: name,
                    CONF_VESSEL_ID: _normalize(user_input.get(CONF_VESSEL_ID)),
                    CONF_HOME_PORT: _normalize(user_input.get(CONF_HOME_PORT)),
                    CONF_DEFAULT_TIMEZONE: default_tz,
                    CONF_CURRENT_TIMEZONE: current_tz,
                }
                await self.async_set_unique_id(data[CONF_VESSEL_ID] or name)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=name, data=data)

        schema = vol.Schema(
            {
                vol.Required(CONF_VESSEL_NAME): str,
                vol.Optional(CONF_VESSEL_ID): str,
                vol.Optional(CONF_HOME_PORT): str,
                vol.Required(CONF_DEFAULT_TIMEZONE, default=ha_tz): str,
                vol.Optional(CONF_CURRENT_TIMEZONE): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> BoatManagementOptionsFlow:
        return BoatManagementOptionsFlow(entry)


class BoatManagementOptionsFlow(OptionsFlow):
    """Edit operational options such as the current vessel timezone."""

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}
        current = {**self._entry.data, **self._entry.options}
        ha_tz = self.hass.config.time_zone or "UTC"

        if user_input is not None:
            default_tz = _normalize(user_input.get(CONF_DEFAULT_TIMEZONE)) or ha_tz
            current_tz = _normalize(user_input.get(CONF_CURRENT_TIMEZONE)) or default_tz
            if not is_valid_timezone(default_tz):
                errors[CONF_DEFAULT_TIMEZONE] = "invalid_timezone"
            if not is_valid_timezone(current_tz):
                errors[CONF_CURRENT_TIMEZONE] = "invalid_timezone"

            if not errors:
                return self.async_create_entry(
                    title="",
                    data={
                        CONF_DEFAULT_TIMEZONE: default_tz,
                        CONF_CURRENT_TIMEZONE: current_tz,
                        CONF_LOW_STOCK_CREATES_WORK: user_input.get(
                            CONF_LOW_STOCK_CREATES_WORK, True
                        ),
                        CONF_CONSUME_ON_VERIFY: user_input.get(
                            CONF_CONSUME_ON_VERIFY, True
                        ),
                        CONF_TRIGGER_AUTORUN: user_input.get(
                            CONF_TRIGGER_AUTORUN, False
                        ),
                        CONF_DIAGNOSTICS_VERBOSE: user_input.get(
                            CONF_DIAGNOSTICS_VERBOSE, False
                        ),
                    },
                )

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_DEFAULT_TIMEZONE,
                    default=current.get(CONF_DEFAULT_TIMEZONE, ha_tz),
                ): str,
                vol.Required(
                    CONF_CURRENT_TIMEZONE,
                    default=current.get(
                        CONF_CURRENT_TIMEZONE,
                        current.get(CONF_DEFAULT_TIMEZONE, ha_tz),
                    ),
                ): str,
                vol.Optional(
                    CONF_LOW_STOCK_CREATES_WORK,
                    default=current.get(CONF_LOW_STOCK_CREATES_WORK, True),
                ): bool,
                vol.Optional(
                    CONF_CONSUME_ON_VERIFY,
                    default=current.get(CONF_CONSUME_ON_VERIFY, True),
                ): bool,
                vol.Optional(
                    CONF_TRIGGER_AUTORUN,
                    default=current.get(CONF_TRIGGER_AUTORUN, False),
                ): bool,
                vol.Optional(
                    CONF_DIAGNOSTICS_VERBOSE,
                    default=current.get(CONF_DIAGNOSTICS_VERBOSE, False),
                ): bool,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
