// Shared record factories + DOM mount helpers for panel tests. Factories return
// fully-populated serialized records (mirroring the backend `to_dict()` shape)
// so individual tests only override the fields they care about.
import type {
  CatalogueTaskRecord,
  CrewRecord,
  EquipmentRecord,
  HomeAssistant,
  InventoryRecord,
  MaintenanceLogRecord,
  SuggestionRecord,
  SystemRecord,
  WorkItemRecord,
} from "../src/types";

export function systemRecord(over: Partial<SystemRecord> = {}): SystemRecord {
  return {
    id: "sys-1",
    name: "Propulsion",
    category: null,
    description: null,
    parent_system_id: null,
    active: true,
    ...over,
  };
}

export function equipmentRecord(
  over: Partial<EquipmentRecord> = {},
): EquipmentRecord {
  return {
    id: "eq-1",
    name: "Port engine",
    system_id: null,
    category: null,
    manufacturer: null,
    model: null,
    serial_number: null,
    location: null,
    installed_date: null,
    commissioned_date: null,
    retired_date: null,
    documentation_refs: [],
    inventory_refs: [],
    meter_refs: [],
    maintenance_interval_days: null,
    active: true,
    ...over,
  };
}

export function inventoryRecord(
  over: Partial<InventoryRecord> = {},
): InventoryRecord {
  return {
    id: "inv-1",
    name: "Impeller",
    quantity: "4",
    unit: "ea",
    category: null,
    manufacturer: null,
    part_number: null,
    storage_location: null,
    minimum_stock: null,
    reorder_level: null,
    equipment_refs: [],
    supplier_refs: [],
    expiry_date: null,
    expired: false,
    active: true,
    ...over,
  };
}

export function catalogueRecord(
  over: Partial<CatalogueTaskRecord> = {},
): CatalogueTaskRecord {
  return {
    id: "task-1",
    title: "Service raw-water pump",
    description: null,
    system_refs: [],
    equipment_refs: [],
    inventory_refs: [],
    required_skills: [],
    estimated_duration_minutes: null,
    procedure: null,
    safety_notes: null,
    default_verifier: null,
    trigger_rules: [],
    last_completed_at_utc: null,
    active: true,
    owner_curated: true,
    ...over,
  };
}

export function crewRecord(over: Partial<CrewRecord> = {}): CrewRecord {
  return {
    id: "crew-1",
    name: "Sam",
    role: "skipper",
    skills: [],
    active: true,
    ...over,
  };
}

export function logRecord(
  over: Partial<MaintenanceLogRecord> = {},
): MaintenanceLogRecord {
  return {
    id: "log-1",
    catalogue_task_id: "task-1",
    work_item_id: "wi-1",
    verified_by: "crew-1",
    completed_by: "crew-1",
    completed_at_utc: "2024-05-01T10:00:00+00:00",
    completed_at_local: "2024-05-01 11:00",
    timezone_at_completion: "Europe/London",
    notes: null,
    ...over,
  };
}

export function suggestionRecord(
  over: Partial<SuggestionRecord> = {},
): SuggestionRecord {
  return {
    catalogue_task_id: "task-1",
    title: "Service raw-water pump",
    source: "calendar",
    key: null,
    context_id: null,
    context_label: null,
    reason: "Never completed",
    dedup_key: "task-1|calendar||",
    already_open: false,
    ...over,
  };
}

export function workItemRecord(
  over: Partial<WorkItemRecord> = {},
): WorkItemRecord {
  return {
    id: "wi-1",
    catalogue_task_id: "task-1",
    status: "todo",
    trigger_source: "manual",
    trigger_key: null,
    operational_context_id: null,
    title: "Service raw-water pump",
    assigned_to: null,
    due_date: null,
    created_at_utc: "2024-05-01T09:00:00+00:00",
    started_at_utc: null,
    finished_at_utc: null,
    submitted_for_review_at_utc: null,
    verified_by: null,
    verified_at_utc: null,
    timezone_at_creation: "Europe/London",
    timezone_at_completion: null,
    completion_notes: null,
    block_reason: null,
    evidence_refs: [],
    inventory_used: [],
    meter_readings: {},
    ...over,
  };
}

// --- Home Assistant double ---------------------------------------------------
export interface FakeHass {
  hass: HomeAssistant;
  calls: Record<string, unknown>[];
  // Override the next/all callWS resolutions in a test if needed.
  reply: (value: unknown) => void;
}

// Minimal `hass` stand-in that records every websocket message the API sends
// and echoes back a server-shaped record (id assigned by "server").
export function fakeHass(): FakeHass {
  const calls: Record<string, unknown>[] = [];
  let next: unknown = null;
  const hass = {
    callWS: async (msg: Record<string, unknown>) => {
      calls.push(msg);
      return next ?? { id: "srv-1", ...msg };
    },
    connection: {
      subscribeMessage: async () => () => {},
    },
  } as unknown as HomeAssistant;
  return { hass, calls, reply: (value: unknown) => (next = value) };
}

// --- DOM helpers -------------------------------------------------------------
// Mount a custom element, apply properties, and wait for the first render.
export async function mount<T extends HTMLElement>(
  tag: string,
  props: Partial<T> = {},
): Promise<T> {
  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

// Resolve with the next event of `type` dispatched from `el`.
export function nextEvent<T = unknown>(
  el: EventTarget,
  type: string,
): Promise<CustomEvent<T>> {
  return new Promise((resolve) => {
    el.addEventListener(type, (e) => resolve(e as CustomEvent<T>), {
      once: true,
    });
  });
}

// Apply property changes and await the re-render.
export async function update(el: HTMLElement): Promise<void> {
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

// Poll until `predicate` is truthy. Used by the panel integration test to wait
// out the fire-and-forget async `_run`/`_refresh` chain (callWS resolves on the
// microtask queue; a short macrotask poll lets it settle deterministically).
export async function waitFor(
  predicate: () => boolean,
  timeout = 1000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
