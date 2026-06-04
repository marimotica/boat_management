"""Constants for the boat_management integration.

Centralizes domain identifiers, storage keys, enum-like value sets, and
service names. Keeping these here avoids stringly-typed literals scattered
through platform code (see AGENTS.md "Implementation Style").
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final

DOMAIN: Final = "boat_management"

# Storage --------------------------------------------------------------------
STORAGE_VERSION: Final = 1
STORAGE_KEY_TEMPLATE: Final = "boat_management.{entry_id}"

# Config entry data / options keys -------------------------------------------
CONF_VESSEL_NAME: Final = "vessel_name"
CONF_VESSEL_ID: Final = "vessel_id"
CONF_HOME_PORT: Final = "home_port"
CONF_DEFAULT_TIMEZONE: Final = "default_timezone"
CONF_CURRENT_TIMEZONE: Final = "current_timezone"
CONF_UNITS: Final = "units"
CONF_LOW_STOCK_CREATES_WORK: Final = "low_stock_creates_work"
CONF_CONSUME_ON_VERIFY: Final = "consume_inventory_on_verify"
CONF_DIAGNOSTICS_VERBOSE: Final = "diagnostics_verbose"
CONF_TRIGGER_AUTORUN: Final = "trigger_autorun"

DEFAULT_UNITS: Final = {"length": "m", "volume": "L", "temperature": "C"}

# Domain storage collections --------------------------------------------------
COLLECTION_SYSTEMS: Final = "systems"
COLLECTION_EQUIPMENT: Final = "equipment"
COLLECTION_INVENTORY: Final = "inventory"
COLLECTION_TASK_CATALOGUE: Final = "task_catalogue"
COLLECTION_WORK_ITEMS: Final = "work_items"
COLLECTION_MAINTENANCE_LOG: Final = "maintenance_log"
COLLECTION_CREW: Final = "crew"
COLLECTION_DOCUMENTS: Final = "documents"
COLLECTION_AUDIT_EVENTS: Final = "audit_events"

ALL_COLLECTIONS: Final = (
    COLLECTION_SYSTEMS,
    COLLECTION_EQUIPMENT,
    COLLECTION_INVENTORY,
    COLLECTION_TASK_CATALOGUE,
    COLLECTION_WORK_ITEMS,
    COLLECTION_MAINTENANCE_LOG,
    COLLECTION_CREW,
    COLLECTION_DOCUMENTS,
    COLLECTION_AUDIT_EVENTS,
)


class WorkItemStatus(StrEnum):
    """Lifecycle states for a Work Item."""

    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    DONE = "done"
    BLOCKED = "blocked"
    DEFERRED = "deferred"
    CANCELLED = "cancelled"


#: States that still represent open, actionable work.
ACTIVE_WORK_STATUSES: Final = frozenset(
    {
        WorkItemStatus.TODO,
        WorkItemStatus.IN_PROGRESS,
        WorkItemStatus.REVIEW,
        WorkItemStatus.BLOCKED,
        WorkItemStatus.DEFERRED,
    }
)

#: Terminal states.
TERMINAL_WORK_STATUSES: Final = frozenset(
    {WorkItemStatus.DONE, WorkItemStatus.CANCELLED}
)


class TriggerSource(StrEnum):
    """Recognized operational trigger sources."""

    MANUAL = "manual"
    PASSAGE_PLAN = "passage_plan"
    SEASONAL_TRANSITION = "seasonal_transition"
    ENGINE_HOURS = "engine_hours"
    CALENDAR = "calendar"
    INVENTORY = "inventory"
    INSPECTION_RESULT = "inspection_result"
    EQUIPMENT_FAULT = "equipment_fault"
    METER_THRESHOLD = "meter_threshold"


class TimezoneSource(StrEnum):
    """Where the active vessel timezone value came from."""

    MANUAL = "manual"
    HOME_PORT = "home_port"
    GPS_POSITION = "gps_position"
    IMPORTED = "imported"


class CrewRole(StrEnum):
    """Roles relevant to verification permissions."""

    CAPTAIN = "captain"
    SKIPPER = "skipper"
    VERIFIER = "verifier"
    CREW = "crew"


#: Roles permitted to verify work into the immutable logbook.
VERIFIER_ROLES: Final = frozenset(
    {CrewRole.CAPTAIN, CrewRole.SKIPPER, CrewRole.VERIFIER}
)


class AuditEventType(StrEnum):
    """Audit event categories."""

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    RETIRE = "retire"
    ARCHIVE = "archive"
    TRANSITION = "transition"
    VERIFY = "verify"
    CONSUME = "consume"
    ADJUST = "adjust"
    IMPORT = "import"
    TIMEZONE_CHANGE = "timezone_change"


# Services -------------------------------------------------------------------
SERVICE_UPDATE_VESSEL: Final = "update_vessel"
SERVICE_SET_VESSEL_TIMEZONE: Final = "set_vessel_timezone"

SERVICE_CREATE_SYSTEM: Final = "create_system"
SERVICE_UPDATE_SYSTEM: Final = "update_system"
SERVICE_ARCHIVE_SYSTEM: Final = "archive_system"

SERVICE_CREATE_EQUIPMENT: Final = "create_equipment"
SERVICE_UPDATE_EQUIPMENT: Final = "update_equipment"
SERVICE_RETIRE_EQUIPMENT: Final = "retire_equipment"

SERVICE_CREATE_INVENTORY_ITEM: Final = "create_inventory_item"
SERVICE_UPDATE_INVENTORY_ITEM: Final = "update_inventory_item"
SERVICE_ADJUST_INVENTORY_QUANTITY: Final = "adjust_inventory_quantity"
SERVICE_CONSUME_INVENTORY: Final = "consume_inventory"
SERVICE_MOVE_INVENTORY: Final = "move_inventory"
SERVICE_MARK_INVENTORY_EXPIRED: Final = "mark_inventory_expired"

SERVICE_CREATE_CATALOGUE_TASK: Final = "create_catalogue_task"
SERVICE_UPDATE_CATALOGUE_TASK: Final = "update_catalogue_task"
SERVICE_ARCHIVE_CATALOGUE_TASK: Final = "archive_catalogue_task"
SERVICE_LOAD_SEED_CATALOGUE: Final = "load_seed_catalogue"

SERVICE_CREATE_WORK_ITEM: Final = "create_work_item"
SERVICE_CLAIM_WORK_ITEM: Final = "claim_work_item"
SERVICE_START_WORK_ITEM: Final = "start_work_item"
SERVICE_SUBMIT_FOR_REVIEW: Final = "submit_for_review"
SERVICE_VERIFY_WORK_ITEM: Final = "verify_work_item"
SERVICE_BLOCK_WORK_ITEM: Final = "block_work_item"
SERVICE_DEFER_WORK_ITEM: Final = "defer_work_item"
SERVICE_CANCEL_WORK_ITEM: Final = "cancel_work_item"
SERVICE_REOPEN_WORK_ITEM: Final = "reopen_work_item"

SERVICE_APPLY_TRIGGER_RULES: Final = "apply_trigger_rules"
SERVICE_IMPORT_DATA: Final = "import_data"
SERVICE_EXPORT_DATA: Final = "export_data"
SERVICE_EXPORT_LOGBOOK: Final = "export_logbook"

# Repair issue identifiers ----------------------------------------------------
ISSUE_INVALID_TIMEZONE: Final = "invalid_vessel_timezone"
ISSUE_MISSING_EQUIPMENT_REF: Final = "missing_equipment_reference"
ISSUE_MISSING_INVENTORY_REF: Final = "missing_inventory_reference"
ISSUE_MISSING_CATALOGUE_REF: Final = "missing_catalogue_task_reference"
ISSUE_NEGATIVE_INVENTORY: Final = "negative_inventory_quantity"
ISSUE_INVALID_TRIGGER_RULE: Final = "invalid_trigger_rule"
ISSUE_DUPLICATE_STABLE_ID: Final = "duplicate_stable_id"
ISSUE_MIGRATION_FAILED: Final = "migration_failed"
ISSUE_LOG_MISSING_TIMEZONE: Final = "log_entry_missing_timezone"

# Platforms ------------------------------------------------------------------
PLATFORMS: Final = ["binary_sensor", "sensor", "todo"]

# Import/export schema --------------------------------------------------------
EXPORT_SCHEMA_VERSION: Final = 1

# Custom panel (frontend) ----------------------------------------------------
#: Sidebar URL slug for the management app.
PANEL_URL_PATH: Final = "boat-management"
#: Custom element name the bundle defines.
PANEL_WEBCOMPONENT: Final = "boat-management-panel"
PANEL_TITLE: Final = "Boat"
PANEL_ICON: Final = "mdi:sail-boat"
#: HTTP path the built JS module is served from (versioned to bust caches).
PANEL_STATIC_URL: Final = f"/{DOMAIN}_frontend/boat-management-panel.js"
#: Filename of the committed bundle under the integration's frontend/ dir.
PANEL_BUNDLE_FILENAME: Final = "boat-management-panel.js"
