"""Inventory registry domain operations (pure over :class:`BoatData`).

Inventory quantities are validated before consumption. Quantity corrections,
consumption, moves and expiry all produce audit events so stock changes stay
traceable (AGENTS.md inventory rules).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from .audit import record_audit
from .const import AuditEventType
from .data import BoatData
from .models import InventoryItem, new_id
from .validators import (
    ValidationError,
    require_existing,
    require_non_empty,
    validate_consumption,
    validate_quantity,
    validate_refs,
)

_MUTABLE_FIELDS = {
    "name",
    "unit",
    "category",
    "manufacturer",
    "part_number",
    "storage_location",
    "minimum_stock",
    "reorder_level",
    "equipment_refs",
    "supplier_refs",
    "expiry_date",
    "active",
}


def create_inventory_item(
    data: BoatData,
    *,
    name: str,
    quantity: Any = "0",
    unit: str = "ea",
    equipment_refs: list[str] | None = None,
    minimum_stock: Any = None,
    reorder_level: Any = None,
    actor: str | None = None,
    now: datetime | None = None,
    **fields: Any,
) -> InventoryItem:
    name = require_non_empty(name, "name")
    qty = validate_quantity(quantity)
    if equipment_refs:
        validate_refs(equipment_refs, data.equipment, "equipment")

    extra = set(fields) - (
        _MUTABLE_FIELDS
        - {"name", "unit", "equipment_refs", "minimum_stock", "reorder_level"}
    )
    if extra:
        raise ValidationError(f"Unknown inventory field(s): {sorted(extra)}")

    item = InventoryItem(
        id=new_id("inv"),
        name=name,
        quantity=qty,
        unit=unit,
        equipment_refs=list(equipment_refs or []),
        minimum_stock=(
            None if minimum_stock is None else validate_quantity(minimum_stock)
        ),
        reorder_level=(
            None if reorder_level is None else validate_quantity(reorder_level)
        ),
        **fields,
    )
    data.inventory[item.id] = item
    record_audit(
        data.audit_events,
        event_type=AuditEventType.CREATE,
        object_type="inventory",
        object_id=item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        after=item.to_dict(),
        now=now,
    )
    return item


def update_inventory_item(
    data: BoatData,
    *,
    inventory_id: str,
    changes: dict[str, Any],
    actor: str | None = None,
    now: datetime | None = None,
) -> InventoryItem:
    require_existing(inventory_id, data.inventory, "inventory")
    item = data.inventory[inventory_id]
    before = item.to_dict()

    unknown = set(changes) - _MUTABLE_FIELDS
    if unknown:
        raise ValidationError(f"Cannot update inventory field(s): {sorted(unknown)}")

    changes = dict(changes)
    if "name" in changes:
        changes["name"] = require_non_empty(changes["name"], "name")
    for num_field in ("minimum_stock", "reorder_level"):
        if num_field in changes and changes[num_field] is not None:
            changes[num_field] = validate_quantity(changes[num_field])
    if changes.get("equipment_refs"):
        validate_refs(changes["equipment_refs"], data.equipment, "equipment")

    for key, value in changes.items():
        setattr(item, key, value)

    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="inventory",
        object_id=item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=item.to_dict(),
        now=now,
    )
    return item


def adjust_inventory_quantity(
    data: BoatData,
    *,
    inventory_id: str,
    delta: Any,
    reason: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> InventoryItem:
    """Apply a signed correction to stock. Result must not go negative."""
    require_existing(inventory_id, data.inventory, "inventory")
    item = data.inventory[inventory_id]
    before = item.to_dict()
    try:
        change = Decimal(str(delta))
    except (ArithmeticError, ValueError) as err:
        raise ValidationError(f"Invalid quantity delta: {delta!r}") from err

    new_qty = item.quantity + change
    if new_qty < 0:
        raise ValidationError(
            f"Adjustment would make inventory '{item.name}' negative "
            f"({item.quantity} + {change})"
        )
    item.quantity = new_qty
    record_audit(
        data.audit_events,
        event_type=AuditEventType.ADJUST,
        object_type="inventory",
        object_id=item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=item.to_dict(),
        reason=reason,
        now=now,
    )
    return item


def consume_inventory(
    data: BoatData,
    *,
    inventory_id: str,
    quantity: Any,
    reason: str | None = None,
    actor: str | None = None,
    now: datetime | None = None,
) -> InventoryItem:
    """Consume stock, validating availability first."""
    require_existing(inventory_id, data.inventory, "inventory")
    item = data.inventory[inventory_id]
    before = item.to_dict()
    qty = validate_quantity(quantity, allow_zero=False)
    validate_consumption(item, qty)
    item.quantity -= qty
    record_audit(
        data.audit_events,
        event_type=AuditEventType.CONSUME,
        object_type="inventory",
        object_id=item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=item.to_dict(),
        reason=reason,
        now=now,
    )
    return item


def move_inventory(
    data: BoatData,
    *,
    inventory_id: str,
    storage_location: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> InventoryItem:
    require_existing(inventory_id, data.inventory, "inventory")
    item = data.inventory[inventory_id]
    before = item.to_dict()
    item.storage_location = require_non_empty(storage_location, "storage_location")
    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="inventory",
        object_id=item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=item.to_dict(),
        reason="moved",
        now=now,
    )
    return item


def mark_inventory_expired(
    data: BoatData,
    *,
    inventory_id: str,
    actor: str | None = None,
    now: datetime | None = None,
) -> InventoryItem:
    require_existing(inventory_id, data.inventory, "inventory")
    item = data.inventory[inventory_id]
    before = item.to_dict()
    item.expired = True
    record_audit(
        data.audit_events,
        event_type=AuditEventType.UPDATE,
        object_type="inventory",
        object_id=item.id,
        timezone_name=data.vessel.current_timezone,
        actor=actor,
        before=before,
        after=item.to_dict(),
        reason="marked expired",
        now=now,
    )
    return item
