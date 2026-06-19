"""Config and options flow for boat_management.

Setup collects vessel identity. The timezone is always taken from Home
Assistant's configured timezone and kept in sync automatically — there is
no separate vessel timezone field to configure.
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
    CONF_DIAGNOSTICS_VERBOSE,
    CONF_HOME_PORT,
    CONF_LOW_STOCK_CREATES_WORK,
    CONF_TRIGGER_AUTORUN,
    CONF_VESSEL_ID,
    CONF_VESSEL_NAME,
    DOMAIN,
)
import homeassistant.helpers.config_validation as cv


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

        if user_input is not None:
            name = _normalize(user_input.get(CONF_VESSEL_NAME))

            if not name:
                errors[CONF_VESSEL_NAME] = "required"

            if not errors:
                data = {
                    CONF_VESSEL_NAME: name,
                    CONF_VESSEL_ID: _normalize(user_input.get(CONF_VESSEL_ID)),
                    CONF_HOME_PORT: _normalize(user_input.get(CONF_HOME_PORT)),
                }
                await self.async_set_unique_id(data[CONF_VESSEL_ID] or name)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=name, data=data)

        schema = vol.Schema(
            {
                vol.Required(CONF_VESSEL_NAME): str,
                vol.Optional(CONF_VESSEL_ID): str,
                vol.Optional(CONF_HOME_PORT): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> BoatManagementOptionsFlow:
        return BoatManagementOptionsFlow(entry)


class BoatManagementOptionsFlow(OptionsFlow):
    """Edit operational options for the vessel."""

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        current = {**self._entry.data, **self._entry.options}

        if user_input is not None:
            return self.async_create_entry(
                title="",
                data={
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
        return self.async_show_form(step_id="init", data_schema=schema)
