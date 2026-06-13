// Thin wrapper over the Home Assistant websocket connection. Every method maps
// 1:1 onto a boat_management command. The backend assigns and returns stable
// ids, so the UI never invents them; create/update return the full record for
// optimistic reconciliation.
import type {
  ApplyTriggerResult,
  BootstrapResult,
  CatalogueTaskRecord,
  ChangeEvent,
  EquipmentRecord,
  HomeAssistant,
  InventoryRecord,
  MaintenanceLogRecord,
  MediaUploadResult,
  SuggestionsResult,
  SystemRecord,
  UnsubscribeFunc,
  WorkItemRecord,
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

export interface CatalogueDraftFields {
  title: string;
  description?: string;
  procedure?: string;
  safety_notes?: string;
  estimated_duration_minutes?: number;
  default_verifier?: string;
  system_refs?: string[];
  equipment_refs?: string[];
  inventory_refs?: string[];
  required_skills?: string[];
}

export interface WorkItemDraftFields {
  catalogue_task_id: string;
  title?: string;
  assigned_to?: string;
  due_date?: string;
  trigger_source?: string;
  trigger_key?: string;
  operational_context_id?: string;
}

// Input for applying a trigger. Suggestion mode passes `catalogue_task_id` (plus
// the suggestion's key/context) to instantiate exactly that task; event mode
// omits it so the backend matcher selects tasks from the raw event. `value`
// feeds threshold sources (engine hours, meter). `dry_run` plans without writing.
export interface ApplyTriggerFields {
  source: string;
  catalogue_task_id?: string;
  key?: string;
  context_id?: string;
  value?: number;
  dry_run?: boolean;
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

  // --- Operational intelligence --------------------------------------------
  // Read-only: state-driven maintenance suggestions (low stock + calendar due).
  // Each suggestion carries the trigger context to echo back to applyTrigger.
  suggestions(): Promise<SuggestionsResult> {
    return this.hass.callWS<SuggestionsResult>({
      type: "boat_management/suggestions",
    });
  }

  // Instantiate catalogue task(s) from an operational event or an accepted
  // suggestion. The backend validates references and dedups against open work
  // (so a double-apply is a safe no-op), then returns what it created.
  applyTrigger(fields: ApplyTriggerFields): Promise<ApplyTriggerResult> {
    return this.hass.callWS<ApplyTriggerResult>({
      type: "boat_management/apply_trigger",
      ...prune(fields),
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

  // --- Task catalogue ------------------------------------------------------
  createCatalogueTask(
    fields: CatalogueDraftFields,
  ): Promise<CatalogueTaskRecord> {
    return this.hass.callWS<CatalogueTaskRecord>({
      type: "boat_management/create_catalogue_task",
      ...prune(fields),
    });
  }

  updateCatalogueTask(
    catalogue_task_id: string,
    changes: Record<string, unknown>,
  ): Promise<CatalogueTaskRecord> {
    return this.hass.callWS<CatalogueTaskRecord>({
      type: "boat_management/update_catalogue_task",
      catalogue_task_id,
      changes,
    });
  }

  archiveCatalogueTask(catalogue_task_id: string): Promise<CatalogueTaskRecord> {
    return this.hass.callWS<CatalogueTaskRecord>({
      type: "boat_management/archive_catalogue_task",
      catalogue_task_id,
    });
  }

  // --- Work items ----------------------------------------------------------
  // A work item is always instantiated from a known catalogue task (operational
  // events instantiate known tasks; they never invent arbitrary work). Every
  // lifecycle method returns the full record so the shell can reconcile; verify
  // is special and returns the immutable maintenance log entry it created.
  createWorkItem(fields: WorkItemDraftFields): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/create_work_item",
      ...prune(fields),
    });
  }

  claimWorkItem(work_item_id: string, crew_id: string): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/claim_work_item",
      work_item_id,
      crew_id,
    });
  }

  startWorkItem(work_item_id: string): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/start_work_item",
      work_item_id,
    });
  }

  submitForReview(
    work_item_id: string,
    completion_notes?: string,
  ): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/submit_for_review",
      ...prune({ work_item_id, completion_notes }),
    });
  }

  blockWorkItem(
    work_item_id: string,
    block_reason?: string,
  ): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/block_work_item",
      ...prune({ work_item_id, block_reason }),
    });
  }

  deferWorkItem(work_item_id: string, reason?: string): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/defer_work_item",
      ...prune({ work_item_id, reason }),
    });
  }

  cancelWorkItem(
    work_item_id: string,
    reason?: string,
  ): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/cancel_work_item",
      ...prune({ work_item_id, reason }),
    });
  }

  // Move a blocked/deferred item back into the active flow (todo by default,
  // or in_progress to resume). The transition is still validated server-side.
  unblockWorkItem(
    work_item_id: string,
    target?: string,
  ): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/unblock_work_item",
      ...prune({ work_item_id, target }),
    });
  }

  // Reopen never deletes history: the backend creates a NEW corrective work
  // item (returned here) and leaves the original done item and its log entry.
  reopenWorkItem(
    work_item_id: string,
    reason?: string,
  ): Promise<WorkItemRecord> {
    return this.hass.callWS<WorkItemRecord>({
      type: "boat_management/reopen_work_item",
      ...prune({ work_item_id, reason }),
    });
  }

  // Verification (review -> done) creates an immutable maintenance log entry,
  // which is what the command returns (not the work item).
  verifyWorkItem(
    work_item_id: string,
    verified_by: string,
    notes?: string,
  ): Promise<MaintenanceLogRecord> {
    return this.hass.callWS<MaintenanceLogRecord>({
      type: "boat_management/verify_work_item",
      ...prune({ work_item_id, verified_by, notes }),
    });
  }

  // --- Media ---------------------------------------------------------------
  // Upload a photo/PDF as base64 and attach it to an existing equipment/inventory
  // record. The target must already exist (the backend re-validates under its
  // lock), so this is an edit-mode action only. All fields are required, so the
  // payload is sent verbatim (no pruning — `data` is the base64 blob).
  uploadMedia(fields: {
    target_type: string;
    target_id: string;
    filename: string;
    content_type: string;
    data: string;
  }): Promise<MediaUploadResult> {
    return this.hass.callWS<MediaUploadResult>({
      type: "boat_management/upload_media",
      ...fields,
    });
  }

  // Detach (and forget) a document by its opaque id. The backend removes the
  // ref + metadata and deletes the blob; the audit trail keeps the record.
  detachMedia(
    document_id: string,
  ): Promise<{ document_id: string; detached: boolean }> {
    return this.hass.callWS({
      type: "boat_management/detach_media",
      document_id,
    });
  }

  // Sign an authenticated path so a plain <img>/<a> can load the media view
  // (requires_auth=True) without an Authorization header. HA returns a path with
  // a short-lived `authSig` query param. We sign generously so an open sheet's
  // thumbnails do not expire mid-session.
  signPath(path: string, expires = 3600): Promise<{ path: string }> {
    return this.hass.callWS<{ path: string }>({
      type: "auth/sign_path",
      path,
      expires,
    });
  }
}

// Build the (unsigned) media-view path for a document blob. Mirrors the backend
// `build_media_url` so the two never drift; the opaque document id is the lookup
// key, never the filename. Pass the result through `signPath` before display.
export function mediaPath(entryId: string, documentId: string): string {
  return `/api/boat_management/media/${entryId}/${documentId}`;
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
