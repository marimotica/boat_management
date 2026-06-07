"""Service handlers: the controlled write API for boat_management.

Handlers are thin (AGENTS.md): they parse/validate input, resolve the target
coordinator, delegate to pure domain operations via
``coordinator.async_execute`` (which persists and audits), and translate domain
errors into actionable Home Assistant errors. No business logic lives here.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
import logging
from typing import Any

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv
import voluptuous as vol

from . import (
    equipment as equipment_ops,
    inventory as inventory_ops,
    maintenance_log as logbook_ops,
    systems as systems_ops,
    task_catalogue as catalogue_ops,
    vessel as vessel_ops,
    work_items as work_ops,
)
from .const import (
    CONF_CONSUME_ON_VERIFY,
    DOMAIN,
    SERVICE_ADJUST_INVENTORY_QUANTITY,
    SERVICE_APPLY_TRIGGER_RULES,
    SERVICE_ARCHIVE_CATALOGUE_TASK,
    SERVICE_ARCHIVE_SYSTEM,
    SERVICE_BLOCK_WORK_ITEM,
    SERVICE_CANCEL_WORK_ITEM,
    SERVICE_CLAIM_WORK_ITEM,
    SERVICE_CONSUME_INVENTORY,
    SERVICE_CREATE_CATALOGUE_TASK,
    SERVICE_CREATE_EQUIPMENT,
    SERVICE_CREATE_INVENTORY_ITEM,
    SERVICE_CREATE_SYSTEM,
    SERVICE_CREATE_WORK_ITEM,
    SERVICE_DEFER_WORK_ITEM,
    SERVICE_EXPORT_DATA,
    SERVICE_EXPORT_LOGBOOK,
    SERVICE_IMPORT_DATA,
    SERVICE_LOAD_SEED_CATALOGUE,
    SERVICE_MARK_INVENTORY_EXPIRED,
    SERVICE_MOVE_INVENTORY,
    SERVICE_REOPEN_WORK_ITEM,
    SERVICE_RETIRE_EQUIPMENT,
    SERVICE_SET_VESSEL_TIMEZONE,
    SERVICE_START_WORK_ITEM,
    SERVICE_SUBMIT_FOR_REVIEW,
    SERVICE_UPDATE_CATALOGUE_TASK,
    SERVICE_UPDATE_EQUIPMENT,
    SERVICE_UPDATE_INVENTORY_ITEM,
    SERVICE_UPDATE_SYSTEM,
    SERVICE_UPDATE_VESSEL,
    SERVICE_VERIFY_WORK_ITEM,
)
from .coordinator import BoatCoordinator
from .data import BoatData
from .import_export import (
    apply_import,
    export_logbook_payload,
    export_payload,
)
from .seed import apply_seed_catalogue
from .suggestions import plan_trigger_application
from .transitions import TransitionError
from .validators import ValidationError
from .work_items import create_work_items_from_plan

_LOGGER = logging.getLogger(__name__)

ATTR_ENTRY_ID = "entry_id"

# A permissive mapping used for free-form "changes"/"fields" payloads.
_FIELDS = vol.Schema({}, extra=vol.ALLOW_EXTRA)


def _base(extra: dict[Any, Any]) -> vol.Schema:
    """Schema with an optional entry_id plus service-specific fields."""
    return vol.Schema({vol.Optional(ATTR_ENTRY_ID): cv.string, **extra})


def _get_coordinator(hass: HomeAssistant, call: ServiceCall) -> BoatCoordinator:
    """Resolve the target coordinator from entry_id, or the sole entry."""
    domain_data: dict[str, BoatCoordinator] = hass.data.get(DOMAIN, {})
    if not domain_data:
        raise HomeAssistantError("Boat Management is not set up")
    entry_id = call.data.get(ATTR_ENTRY_ID)
    if entry_id:
        coordinator = domain_data.get(entry_id)
        if coordinator is None:
            raise HomeAssistantError(f"No vessel configured for entry '{entry_id}'")
        return coordinator
    if len(domain_data) > 1:
        raise HomeAssistantError(
            "Multiple vessels configured; specify 'entry_id' in the service call"
        )
    return next(iter(domain_data.values()))


def _strip_entry(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if k != ATTR_ENTRY_ID}


# ---------------------------------------------------------------------------
# Handler registry: name -> (schema, handler, supports_response)
# ---------------------------------------------------------------------------
HandlerType = Callable[[HomeAssistant, ServiceCall], Awaitable[ServiceResponse]]


def _make_simple(
    op: Callable[..., Any],
    *,
    arg_map: Callable[[dict[str, Any]], dict[str, Any]],
) -> HandlerType:
    """Build a handler that runs a domain op via the coordinator."""

    async def _handler(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
        coordinator = _get_coordinator(hass, call)
        kwargs = arg_map(_strip_entry(dict(call.data)))
        kwargs["actor"] = call.context.user_id
        result = await coordinator.async_execute(op, **kwargs)
        obj_id = getattr(result, "id", None)
        return {"id": obj_id} if obj_id else None

    return _handler


def _register(
    registry: dict[str, tuple[vol.Schema, HandlerType, SupportsResponse]],
    name: str,
    schema: vol.Schema,
    handler: HandlerType,
    response: SupportsResponse = SupportsResponse.OPTIONAL,
) -> None:
    registry[name] = (schema, handler, response)


def _build_registry() -> dict[str, tuple[vol.Schema, HandlerType, SupportsResponse]]:
    reg: dict[str, tuple[vol.Schema, HandlerType, SupportsResponse]] = {}

    # Vessel -----------------------------------------------------------------
    _register(
        reg,
        SERVICE_UPDATE_VESSEL,
        _base({vol.Required("changes"): _FIELDS}),
        _make_simple(
            vessel_ops.update_vessel,
            arg_map=lambda d: {"changes": d["changes"]},
        ),
    )
    _register(
        reg,
        SERVICE_SET_VESSEL_TIMEZONE,
        _base({vol.Required("timezone"): cv.string, vol.Optional("source"): cv.string}),
        _make_simple(
            vessel_ops.set_vessel_timezone,
            arg_map=lambda d: {
                "timezone_name": d["timezone"],
                **({"source": d["source"]} if "source" in d else {}),
            },
        ),
    )

    # Systems ----------------------------------------------------------------
    _register(
        reg,
        SERVICE_CREATE_SYSTEM,
        _base(
            {
                vol.Required("name"): cv.string,
                vol.Optional("category"): cv.string,
                vol.Optional("description"): cv.string,
                vol.Optional("parent_system_id"): cv.string,
            }
        ),
        _make_simple(systems_ops.create_system, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_UPDATE_SYSTEM,
        _base({vol.Required("system_id"): cv.string, vol.Required("changes"): _FIELDS}),
        _make_simple(
            systems_ops.update_system,
            arg_map=lambda d: {"system_id": d["system_id"], "changes": d["changes"]},
        ),
    )
    _register(
        reg,
        SERVICE_ARCHIVE_SYSTEM,
        _base({vol.Required("system_id"): cv.string}),
        _make_simple(
            systems_ops.archive_system,
            arg_map=lambda d: {"system_id": d["system_id"]},
        ),
    )

    # Equipment --------------------------------------------------------------
    _register(
        reg,
        SERVICE_CREATE_EQUIPMENT,
        _base(
            {
                vol.Required("name"): cv.string,
                vol.Optional("system_id"): cv.string,
                vol.Optional("inventory_refs"): [cv.string],
                vol.Optional("category"): cv.string,
                vol.Optional("manufacturer"): cv.string,
                vol.Optional("model"): cv.string,
                vol.Optional("serial_number"): cv.string,
                vol.Optional("location"): cv.string,
                vol.Optional("maintenance_interval_days"): vol.Coerce(int),
            }
        ),
        _make_simple(equipment_ops.create_equipment, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_UPDATE_EQUIPMENT,
        _base(
            {vol.Required("equipment_id"): cv.string, vol.Required("changes"): _FIELDS}
        ),
        _make_simple(
            equipment_ops.update_equipment,
            arg_map=lambda d: {
                "equipment_id": d["equipment_id"],
                "changes": d["changes"],
            },
        ),
    )
    _register(
        reg,
        SERVICE_RETIRE_EQUIPMENT,
        _base(
            {
                vol.Required("equipment_id"): cv.string,
                vol.Optional("retired_date"): cv.string,
            }
        ),
        _make_simple(
            equipment_ops.retire_equipment,
            arg_map=lambda d: {
                "equipment_id": d["equipment_id"],
                **({"retired_date": d["retired_date"]} if "retired_date" in d else {}),
            },
        ),
    )

    # Inventory --------------------------------------------------------------
    _register(
        reg,
        SERVICE_CREATE_INVENTORY_ITEM,
        _base(
            {
                vol.Required("name"): cv.string,
                vol.Optional("quantity"): vol.Coerce(str),
                vol.Optional("unit"): cv.string,
                vol.Optional("equipment_refs"): [cv.string],
                vol.Optional("minimum_stock"): vol.Coerce(str),
                vol.Optional("reorder_level"): vol.Coerce(str),
                vol.Optional("category"): cv.string,
                vol.Optional("part_number"): cv.string,
                vol.Optional("storage_location"): cv.string,
                vol.Optional("expiry_date"): cv.string,
            }
        ),
        _make_simple(inventory_ops.create_inventory_item, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_UPDATE_INVENTORY_ITEM,
        _base(
            {vol.Required("inventory_id"): cv.string, vol.Required("changes"): _FIELDS}
        ),
        _make_simple(
            inventory_ops.update_inventory_item,
            arg_map=lambda d: {
                "inventory_id": d["inventory_id"],
                "changes": d["changes"],
            },
        ),
    )
    _register(
        reg,
        SERVICE_ADJUST_INVENTORY_QUANTITY,
        _base(
            {
                vol.Required("inventory_id"): cv.string,
                vol.Required("delta"): vol.Coerce(str),
                vol.Optional("reason"): cv.string,
            }
        ),
        _make_simple(
            inventory_ops.adjust_inventory_quantity,
            arg_map=lambda d: {
                "inventory_id": d["inventory_id"],
                "delta": d["delta"],
                **({"reason": d["reason"]} if "reason" in d else {}),
            },
        ),
    )
    _register(
        reg,
        SERVICE_CONSUME_INVENTORY,
        _base(
            {
                vol.Required("inventory_id"): cv.string,
                vol.Required("quantity"): vol.Coerce(str),
                vol.Optional("reason"): cv.string,
            }
        ),
        _make_simple(
            inventory_ops.consume_inventory,
            arg_map=lambda d: {
                "inventory_id": d["inventory_id"],
                "quantity": d["quantity"],
                **({"reason": d["reason"]} if "reason" in d else {}),
            },
        ),
    )
    _register(
        reg,
        SERVICE_MOVE_INVENTORY,
        _base(
            {
                vol.Required("inventory_id"): cv.string,
                vol.Required("storage_location"): cv.string,
            }
        ),
        _make_simple(
            inventory_ops.move_inventory,
            arg_map=lambda d: {
                "inventory_id": d["inventory_id"],
                "storage_location": d["storage_location"],
            },
        ),
    )
    _register(
        reg,
        SERVICE_MARK_INVENTORY_EXPIRED,
        _base({vol.Required("inventory_id"): cv.string}),
        _make_simple(
            inventory_ops.mark_inventory_expired,
            arg_map=lambda d: {"inventory_id": d["inventory_id"]},
        ),
    )

    # Task catalogue ---------------------------------------------------------
    _register(
        reg,
        SERVICE_CREATE_CATALOGUE_TASK,
        _base(
            {
                vol.Required("title"): cv.string,
                vol.Optional("description"): cv.string,
                vol.Optional("system_refs"): [cv.string],
                vol.Optional("equipment_refs"): [cv.string],
                vol.Optional("inventory_refs"): [cv.string],
                vol.Optional("required_skills"): [cv.string],
                vol.Optional("estimated_duration_minutes"): vol.Coerce(int),
                vol.Optional("procedure"): cv.string,
                vol.Optional("safety_notes"): cv.string,
                vol.Optional("default_verifier"): cv.string,
                vol.Optional("trigger_rules"): [dict],
            }
        ),
        _make_simple(catalogue_ops.create_catalogue_task, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_UPDATE_CATALOGUE_TASK,
        _base(
            {
                vol.Required("catalogue_task_id"): cv.string,
                vol.Required("changes"): _FIELDS,
            }
        ),
        _make_simple(
            catalogue_ops.update_catalogue_task,
            arg_map=lambda d: {
                "catalogue_task_id": d["catalogue_task_id"],
                "changes": d["changes"],
            },
        ),
    )
    _register(
        reg,
        SERVICE_ARCHIVE_CATALOGUE_TASK,
        _base({vol.Required("catalogue_task_id"): cv.string}),
        _make_simple(
            catalogue_ops.archive_catalogue_task,
            arg_map=lambda d: {"catalogue_task_id": d["catalogue_task_id"]},
        ),
    )
    _register(
        reg,
        SERVICE_LOAD_SEED_CATALOGUE,
        _base({vol.Optional("dry_run", default=False): cv.boolean}),
        _seed_handler,
    )

    # Work items -------------------------------------------------------------
    _register(
        reg,
        SERVICE_CREATE_WORK_ITEM,
        _base(
            {
                vol.Required("catalogue_task_id"): cv.string,
                vol.Optional("trigger_source"): cv.string,
                vol.Optional("trigger_key"): cv.string,
                vol.Optional("operational_context_id"): cv.string,
                vol.Optional("title"): cv.string,
                vol.Optional("assigned_to"): cv.string,
                vol.Optional("due_date"): cv.string,
            }
        ),
        _make_simple(work_ops.create_work_item, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_CLAIM_WORK_ITEM,
        _base(
            {
                vol.Required("work_item_id"): cv.string,
                vol.Required("crew_id"): cv.string,
            }
        ),
        _make_simple(
            work_ops.claim_work_item,
            arg_map=lambda d: {
                "work_item_id": d["work_item_id"],
                "crew_id": d["crew_id"],
            },
        ),
    )
    _register(
        reg,
        SERVICE_START_WORK_ITEM,
        _base({vol.Required("work_item_id"): cv.string}),
        _make_simple(
            work_ops.start_work_item,
            arg_map=lambda d: {"work_item_id": d["work_item_id"]},
        ),
    )
    _register(
        reg,
        SERVICE_SUBMIT_FOR_REVIEW,
        _base(
            {
                vol.Required("work_item_id"): cv.string,
                vol.Optional("completion_notes"): cv.string,
                vol.Optional("evidence_refs"): [cv.string],
                vol.Optional("inventory_used"): [dict],
                vol.Optional("meter_readings"): dict,
            }
        ),
        _make_simple(
            work_ops.submit_for_review,
            arg_map=lambda d: d,
        ),
    )
    _register(
        reg,
        SERVICE_BLOCK_WORK_ITEM,
        _base(
            {
                vol.Required("work_item_id"): cv.string,
                vol.Optional("block_reason"): cv.string,
            }
        ),
        _make_simple(work_ops.block_work_item, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_DEFER_WORK_ITEM,
        _base(
            {vol.Required("work_item_id"): cv.string, vol.Optional("reason"): cv.string}
        ),
        _make_simple(work_ops.defer_work_item, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_CANCEL_WORK_ITEM,
        _base(
            {vol.Required("work_item_id"): cv.string, vol.Optional("reason"): cv.string}
        ),
        _make_simple(work_ops.cancel_work_item, arg_map=lambda d: d),
    )
    _register(
        reg,
        SERVICE_REOPEN_WORK_ITEM,
        _base(
            {vol.Required("work_item_id"): cv.string, vol.Optional("reason"): cv.string}
        ),
        _make_simple(work_ops.reopen_work_item, arg_map=lambda d: d),
    )

    # Verification (special: reads option for inventory consumption) ---------
    _register(reg, SERVICE_VERIFY_WORK_ITEM, _verify_schema(), _verify_handler)

    # Triggers & data --------------------------------------------------------
    _register(reg, SERVICE_APPLY_TRIGGER_RULES, _trigger_schema(), _trigger_handler)
    _register(
        reg,
        SERVICE_EXPORT_DATA,
        _base({vol.Optional("include_logbook", default=True): cv.boolean}),
        _export_handler,
    )
    _register(
        reg,
        SERVICE_EXPORT_LOGBOOK,
        _base({}),
        _export_logbook_handler,
    )
    _register(reg, SERVICE_IMPORT_DATA, _import_schema(), _import_handler)

    return reg


# ---------------------------------------------------------------------------
# Special handlers
# ---------------------------------------------------------------------------
def _verify_schema() -> vol.Schema:
    return _base(
        {
            vol.Required("work_item_id"): cv.string,
            vol.Required("verified_by"): cv.string,
            vol.Optional("notes"): cv.string,
            vol.Optional("consume_inventory"): cv.boolean,
        }
    )


async def _verify_handler(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    coordinator = _get_coordinator(hass, call)
    data = _strip_entry(dict(call.data))
    consume_default = bool(
        {**coordinator.entry.data, **coordinator.entry.options}.get(
            CONF_CONSUME_ON_VERIFY, True
        )
    )
    entry = await coordinator.async_execute(
        logbook_ops.verify_work_item,
        work_item_id=data["work_item_id"],
        verified_by=data["verified_by"],
        consume_inventory=data.get("consume_inventory", consume_default),
        notes=data.get("notes"),
        actor=call.context.user_id,
    )
    return {"log_entry_id": entry.id}


def _trigger_schema() -> vol.Schema:
    return _base(
        {
            vol.Required("source"): cv.string,
            vol.Optional("catalogue_task_id"): cv.string,
            vol.Optional("key"): cv.string,
            vol.Optional("context_id"): cv.string,
            vol.Optional("value"): vol.Coerce(float),
            vol.Optional("dry_run", default=False): cv.boolean,
        }
    )


async def _trigger_handler(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    coordinator = _get_coordinator(hass, call)
    data = _strip_entry(dict(call.data))
    dry_run = bool(data.get("dry_run", False))

    # Pure planning first (validates references, applies dedup): a dry-run can
    # report exactly what a real apply would create without touching storage.
    plan = plan_trigger_application(
        coordinator.data,
        source=data["source"],
        catalogue_task_id=data.get("catalogue_task_id"),
        key=data.get("key"),
        context_id=data.get("context_id"),
        value=data.get("value"),
    )
    created_ids: list[str] = []
    if not dry_run and plan.to_create:
        created = await coordinator.async_execute(
            create_work_items_from_plan,
            planned=plan.to_create,
            actor=call.context.user_id,
        )
        created_ids = [wi.id for wi in created]
        coordinator.mark_trigger_run()

    return {
        "dry_run": dry_run,
        "would_create": [p.catalogue_task_id for p in plan.to_create],
        "skipped_existing": [p.catalogue_task_id for p in plan.skipped_existing],
        "created_work_item_ids": created_ids,
    }


async def _seed_handler(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Populate default systems and catalogue tasks (idempotent).

    ``dry_run`` reports what would be added without mutating state.
    """
    coordinator = _get_coordinator(hass, call)
    if bool(call.data.get("dry_run", False)):
        # Compute against live data without persisting or notifying.
        report = apply_seed_catalogue(coordinator.data, dry_run=True)
    else:
        report = await coordinator.async_execute(
            apply_seed_catalogue, actor=call.context.user_id
        )
    return report.as_dict()


async def _export_handler(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    coordinator = _get_coordinator(hass, call)
    include_logbook = bool(call.data.get("include_logbook", True))
    return export_payload(coordinator.data.to_dict(), include_logbook=include_logbook)


async def _export_logbook_handler(
    hass: HomeAssistant, call: ServiceCall
) -> ServiceResponse:
    coordinator = _get_coordinator(hass, call)
    return export_logbook_payload(coordinator.data.to_dict())


def _import_schema() -> vol.Schema:
    return _base(
        {
            vol.Required("payload"): dict,
            vol.Optional("mode", default="merge"): cv.string,
            vol.Optional("dry_run", default=False): cv.boolean,
        }
    )


async def _import_handler(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    coordinator = _get_coordinator(hass, call)
    data = _strip_entry(dict(call.data))
    dry_run = bool(data.get("dry_run", False))
    result_dict, report = apply_import(
        coordinator.data.to_dict(),
        data["payload"],
        mode=data.get("mode", "merge"),
        dry_run=dry_run,
    )
    if not dry_run:
        async with coordinator._lock:  # noqa: SLF001 - intentional internal use
            coordinator.data = BoatData.from_dict(result_dict)
            await coordinator.store.async_save(coordinator.data)
        coordinator.async_notify()
    return report.to_dict()


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
def async_register_services(hass: HomeAssistant) -> None:
    """Register all boat_management services (idempotent)."""
    registry = _build_registry()

    for name, (schema, handler, response) in registry.items():
        if hass.services.has_service(DOMAIN, name):
            continue

        def _make(
            handler: HandlerType = handler,
        ) -> Callable[[ServiceCall], Awaitable[ServiceResponse]]:
            async def _service(call: ServiceCall) -> ServiceResponse:
                try:
                    return await handler(hass, call)
                except (ValidationError, TransitionError) as err:
                    raise HomeAssistantError(str(err)) from err

            return _service

        hass.services.async_register(
            DOMAIN, name, _make(), schema=schema, supports_response=response
        )


def async_unregister_services(hass: HomeAssistant) -> None:
    """Remove all boat_management services."""
    for name in list(_build_registry().keys()):
        if hass.services.has_service(DOMAIN, name):
            hass.services.async_remove(DOMAIN, name)
