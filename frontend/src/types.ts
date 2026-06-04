// Minimal typings for the slice of Home Assistant the panel touches, plus the
// serialized domain records returned by the boat_management websocket API.
// We intentionally avoid depending on HA's frontend types package: the panel is
// loaded at runtime by HA, which injects a richer `hass` object than we type
// here.

export type UnsubscribeFunc = () => void;

export interface HassConnection {
  subscribeMessage<T>(
    callback: (message: T) => void,
    subscribeMessage: Record<string, unknown>,
  ): Promise<UnsubscribeFunc>;
}

export interface HomeAssistant {
  connection: HassConnection;
  callWS<T>(message: Record<string, unknown>): Promise<T>;
  language?: string;
  themes?: unknown;
}

export interface PanelInfo {
  config?: Record<string, unknown> | null;
}

// --- Domain records (serialized) -------------------------------------------
export interface SystemRecord {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  parent_system_id?: string | null;
  active: boolean;
}

// Installed, maintainable vessel asset. Mirrors Equipment.to_dict() server-side.
export interface EquipmentRecord {
  id: string;
  name: string;
  system_id?: string | null;
  category?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  location?: string | null;
  installed_date?: string | null;
  commissioned_date?: string | null;
  retired_date?: string | null;
  documentation_refs: string[];
  inventory_refs: string[];
  meter_refs: string[];
  maintenance_interval_days?: number | null;
  active: boolean;
}

// Spare part / consumable / stock item. Mirrors InventoryItem.to_dict().
// Numeric quantities are serialized as strings to preserve Decimal precision.
export interface InventoryRecord {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  category?: string | null;
  manufacturer?: string | null;
  part_number?: string | null;
  storage_location?: string | null;
  minimum_stock?: string | null;
  reorder_level?: string | null;
  equipment_refs: string[];
  supplier_refs: string[];
  expiry_date?: string | null;
  expired: boolean;
  active: boolean;
}

export interface VesselRecord {
  id: string;
  name: string;
  home_port?: string | null;
  current_timezone?: string | null;
  default_timezone?: string | null;
}

export type RecordMap<T> = Record<string, T>;

export interface BootstrapResult {
  entry_id: string;
  vessel: VesselRecord;
  active_timezone: string;
  schema_version: number;
  collections: {
    systems: RecordMap<SystemRecord>;
    equipment: RecordMap<EquipmentRecord>;
    inventory: RecordMap<InventoryRecord>;
    task_catalogue: RecordMap<Record<string, unknown>>;
    work_items: RecordMap<Record<string, unknown>>;
    maintenance_log: RecordMap<Record<string, unknown>>;
    crew: RecordMap<Record<string, unknown>>;
  };
  counts: Record<string, number>;
}

export interface ChangeEvent {
  event: "changed";
  entry_id: string;
}

// A structured websocket error as surfaced by HA's connection layer.
export interface WsError {
  code: string;
  message: string;
}

export function isWsError(err: unknown): err is WsError {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    "code" in err
  );
}
