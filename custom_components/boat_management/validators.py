"""Pure validation helpers for boat_management.

These functions guard API boundaries and detect persisted inconsistencies.
They never import Home Assistant and operate on plain collections (dicts keyed
by stable id) so they stay directly unit-testable.

Two families live here:

* ``validate_*`` raise :class:`ValidationError` with actionable messages and are
  called by service/domain code *before* writing state.
* ``check_*`` return :class:`ReferenceProblem` lists describing persisted
  integrity issues for diagnostics and repairs (non-raising).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .const import (
    ISSUE_LOG_MISSING_TIMEZONE,
    ISSUE_MISSING_CATALOGUE_REF,
    ISSUE_MISSING_DOCUMENT_REF,
    ISSUE_MISSING_EQUIPMENT_REF,
    ISSUE_MISSING_INVENTORY_REF,
    ISSUE_NEGATIVE_INVENTORY,
    TriggerSource,
)
from .models import (
    Equipment,
    InventoryItem,
    MaintenanceLogEntry,
    System,
    TaskCatalogueItem,
    WorkItem,
)
from .timezone import is_valid_timezone


class ValidationError(ValueError):
    """Raised when user-supplied input or a reference is invalid.

    Service handlers translate this into a Home Assistant error so the skipper
    gets an actionable message rather than a traceback.
    """


@dataclass(frozen=True, slots=True)
class ReferenceProblem:
    """A detected persisted integrity problem (for diagnostics/repairs)."""

    issue_type: str
    object_type: str
    object_id: str
    detail: str
    missing_ref: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_type": self.issue_type,
            "object_type": self.object_type,
            "object_id": self.object_id,
            "detail": self.detail,
            "missing_ref": self.missing_ref,
        }


# ---------------------------------------------------------------------------
# Input validation (raises)
# ---------------------------------------------------------------------------
def require_non_empty(value: Any, field_name: str) -> str:
    """Return a trimmed non-empty string or raise."""
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValidationError(f"'{field_name}' is required and cannot be empty")
    return str(value).strip()


def validate_timezone_value(name: str | None, field_name: str = "timezone") -> str:
    """Validate an IANA timezone string for service input."""
    if not is_valid_timezone(name):
        raise ValidationError(
            f"Invalid {field_name} '{name}'; expected an IANA timezone such as "
            "Europe/Paris or America/New_York"
        )
    return name  # type: ignore[return-value]


def require_existing(
    object_id: str | None,
    collection: Mapping[str, Any],
    object_type: str,
) -> str:
    """Validate that ``object_id`` resolves in ``collection``."""
    if not object_id:
        raise ValidationError(f"A {object_type} id is required")
    if object_id not in collection:
        raise ValidationError(f"Referenced {object_type} '{object_id}' does not exist")
    return object_id


def validate_refs(
    refs: Iterable[str],
    collection: Mapping[str, Any],
    object_type: str,
) -> list[str]:
    """Validate every id in ``refs`` resolves; reject unknowns explicitly."""
    resolved: list[str] = []
    missing: list[str] = []
    for ref in refs:
        if ref in collection:
            resolved.append(ref)
        else:
            missing.append(ref)
    if missing:
        raise ValidationError(
            f"Unknown {object_type} reference(s): {', '.join(sorted(missing))}"
        )
    return resolved


def validate_quantity(value: Any, *, allow_zero: bool = True) -> Decimal:
    """Validate a non-negative Decimal quantity."""
    if isinstance(value, Decimal):
        qty = value
    else:
        try:
            qty = Decimal(str(value))
        except (ArithmeticError, ValueError) as err:
            raise ValidationError(f"Invalid quantity: {value!r}") from err
    if qty < 0:
        raise ValidationError("Quantity cannot be negative")
    if not allow_zero and qty == 0:
        raise ValidationError("Quantity must be greater than zero")
    return qty


def validate_consumption(
    item: InventoryItem,
    requested: Decimal,
) -> None:
    """Ensure there is enough stock to consume ``requested`` of ``item``."""
    if requested <= 0:
        raise ValidationError(
            f"Consumption of inventory '{item.id}' must be greater than zero"
        )
    if requested > item.quantity:
        raise ValidationError(
            f"Cannot consume {requested} of inventory '{item.name}' "
            f"({item.id}); only {item.quantity} {item.unit} in stock"
        )


def validate_trigger_rule_source(source: str) -> str:
    """Validate that a trigger source is a recognized value."""
    valid = {s.value for s in TriggerSource}
    if source not in valid:
        raise ValidationError(
            f"Invalid trigger source '{source}'; expected one of " f"{sorted(valid)}"
        )
    return source


# ---------------------------------------------------------------------------
# Persisted integrity checks (non-raising) for diagnostics & repairs
# ---------------------------------------------------------------------------
def check_equipment_references(
    equipment: Mapping[str, Equipment],
    systems: Mapping[str, System],
    inventory: Mapping[str, InventoryItem],
) -> list[ReferenceProblem]:
    problems: list[ReferenceProblem] = []
    for eq in equipment.values():
        if eq.system_id and eq.system_id not in systems:
            problems.append(
                ReferenceProblem(
                    issue_type=ISSUE_MISSING_EQUIPMENT_REF,
                    object_type="equipment",
                    object_id=eq.id,
                    detail=f"Equipment '{eq.name}' references missing system",
                    missing_ref=eq.system_id,
                )
            )
        for inv_id in eq.inventory_refs:
            if inv_id not in inventory:
                problems.append(
                    ReferenceProblem(
                        issue_type=ISSUE_MISSING_INVENTORY_REF,
                        object_type="equipment",
                        object_id=eq.id,
                        detail=(
                            f"Equipment '{eq.name}' references missing "
                            "inventory item"
                        ),
                        missing_ref=inv_id,
                    )
                )
    return problems


def check_inventory_quantities(
    inventory: Mapping[str, InventoryItem],
) -> list[ReferenceProblem]:
    problems: list[ReferenceProblem] = []
    for item in inventory.values():
        if item.quantity < 0:
            problems.append(
                ReferenceProblem(
                    issue_type=ISSUE_NEGATIVE_INVENTORY,
                    object_type="inventory",
                    object_id=item.id,
                    detail=(
                        f"Inventory '{item.name}' has negative quantity "
                        f"{item.quantity}"
                    ),
                )
            )
    return problems


def check_work_item_references(
    work_items: Mapping[str, WorkItem],
    task_catalogue: Mapping[str, TaskCatalogueItem],
) -> list[ReferenceProblem]:
    problems: list[ReferenceProblem] = []
    for wi in work_items.values():
        if wi.catalogue_task_id not in task_catalogue:
            problems.append(
                ReferenceProblem(
                    issue_type=ISSUE_MISSING_CATALOGUE_REF,
                    object_type="work_item",
                    object_id=wi.id,
                    detail=(
                        f"Work item references missing catalogue task "
                        f"'{wi.catalogue_task_id}'"
                    ),
                    missing_ref=wi.catalogue_task_id,
                )
            )
    return problems


def check_log_entry_timezones(
    maintenance_log: Mapping[str, MaintenanceLogEntry],
) -> list[ReferenceProblem]:
    problems: list[ReferenceProblem] = []
    for entry in maintenance_log.values():
        if not entry.timezone_at_completion:
            problems.append(
                ReferenceProblem(
                    issue_type=ISSUE_LOG_MISSING_TIMEZONE,
                    object_type="maintenance_log",
                    object_id=entry.id,
                    detail="Log entry is missing historical timezone",
                )
            )
    return problems


def check_media_references(
    equipment: Mapping[str, Equipment],
    inventory: Mapping[str, InventoryItem],
    documents: Mapping[str, Any],
) -> list[ReferenceProblem]:
    """Flag ``media_refs`` pointing at a document record that no longer exists.

    A dangling media ref means the panel would render a broken attachment, so it
    is surfaced as a repair/diagnostic rather than silently ignored.
    """
    problems: list[ReferenceProblem] = []
    for holder in (equipment, inventory):
        for owner in holder.values():
            for doc_id in owner.media_refs:
                if doc_id not in documents:
                    problems.append(
                        ReferenceProblem(
                            issue_type=ISSUE_MISSING_DOCUMENT_REF,
                            object_type=(
                                "equipment"
                                if isinstance(owner, Equipment)
                                else "inventory"
                            ),
                            object_id=owner.id,
                            detail=(f"'{owner.name}' references missing document"),
                            missing_ref=doc_id,
                        )
                    )
    return problems
