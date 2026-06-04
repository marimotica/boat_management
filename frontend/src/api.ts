// Thin wrapper over the Home Assistant websocket connection. Every method maps
// 1:1 onto a boat_management command. The backend assigns and returns stable
// ids, so the UI never invents them; create/update return the full record for
// optimistic reconciliation.
import type {
  BootstrapResult,
  ChangeEvent,
  EquipmentRecord,
  HomeAssistant,
  InventoryRecord,
  SystemRecord,
  UnsubscribeFunc,
} from "./types";

export interface EquipmentDraftFields {
  name: string;
  system_id?: string;
  category?: string;
  manufacturer?: string;
  model?: string;
  serial_number?: string;
  location?: string;
  installed_date?: string;
  commissioned_date?: string;
  maintenance_interval_days?: number;
  inventory_refs?: string[];
  documentation_refs?: string[];
}

export interface InventoryDraftFields {
  name: string;
  quantity?: string;
  unit?: string;
  category?: string;
  part_number?: string;
  storage_location?: string;
  minimum_stock?: string;
  reorder_level?: string;
  expiry_date?: string;
  equipment_refs?: string[];
}

export class BoatApi {
  constructor(private readonly hass: HomeAssistant) {}

  bootstrap(): Promise<BootstrapResult> {
    return this.hass.callWS<BootstrapResult>({
      type: "boat_management/bootstrap",
    });
  }

  subscribe(onChange: (event: ChangeEvent) => void): Promise<UnsubscribeFunc> {
    return this.hass.connection.subscribeMessage<ChangeEvent>(onChange, {
      type: "boat_management/subscribe",
    });
  }

  // --- Systems -------------------------------------------------------------
  createSystem(fields: {
    name: string;
    category?: string;
    description?: string;
    parent_system_id?: string;
  }): Promise<SystemRecord> {
    return this.hass.callWS<SystemRecord>({
      type: "boat_management/create_system",
      ...prune(fields),
    });
  }

  updateSystem(
    system_id: string,
    changes: Record<string, unknown>,
  ): Promise<SystemRecord> {
    return this.hass.callWS<SystemRecord>({
      type: "boat_management/update_system",
      system_id,
      changes,
    });
  }

  archiveSystem(system_id: string): Promise<SystemRecord> {
    return this.hass.callWS<SystemRecord>({
      type: "boat_management/archive_system",
      system_id,
    });
  }

  // --- Equipment -----------------------------------------------------------
  createEquipment(fields: EquipmentDraftFields): Promise<EquipmentRecord> {
    return this.hass.callWS<EquipmentRecord>({
      type: "boat_management/create_equipment",
      ...prune(fields),
    });
  }

  updateEquipment(
    equipment_id: string,
    changes: Record<string, unknown>,
  ): Promise<EquipmentRecord> {
    return this.hass.callWS<EquipmentRecord>({
      type: "boat_management/update_equipment",
      equipment_id,
      changes,
    });
  }

  retireEquipment(
    equipment_id: string,
    retired_date?: string,
  ): Promise<EquipmentRecord> {
    return this.hass.callWS<EquipmentRecord>({
      type: "boat_management/retire_equipment",
      ...prune({ equipment_id, retired_date }),
    });
  }

  // --- Inventory -----------------------------------------------------------
  createInventoryItem(fields: InventoryDraftFields): Promise<InventoryRecord> {
    return this.hass.callWS<InventoryRecord>({
      type: "boat_management/create_inventory_item",
      ...prune(fields),
    });
  }

  updateInventoryItem(
    inventory_id: string,
    changes: Record<string, unknown>,
  ): Promise<InventoryRecord> {
    return this.hass.callWS<InventoryRecord>({
      type: "boat_management/update_inventory_item",
      inventory_id,
      changes,
    });
  }

  // Quantity is never set directly on an existing item: stock changes flow
  // through adjust (a signed delta) so every correction is audited.
  adjustInventoryQuantity(
    inventory_id: string,
    delta: string,
    reason?: string,
  ): Promise<InventoryRecord> {
    return this.hass.callWS<InventoryRecord>({
      type: "boat_management/adjust_inventory_quantity",
      ...prune({ inventory_id, delta, reason }),
    });
  }

  markInventoryExpired(inventory_id: string): Promise<InventoryRecord> {
    return this.hass.callWS<InventoryRecord>({
      type: "boat_management/mark_inventory_expired",
      inventory_id,
    });
  }
}

// Drop undefined/empty-string/empty-array fields so optional inputs aren't sent
// as blanks (the backend validators reject empty names, etc.).
function prune(fields: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}
