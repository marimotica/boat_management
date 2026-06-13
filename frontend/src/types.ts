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
  // Opaque ids of attached photo/PDF documents (see DocumentRecord). Managed
  // only via the media upload/detach commands, never free-form edits.
  media_refs: string[];
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
  // Opaque ids of attached photo/PDF documents (see DocumentRecord). Managed
  // only via the media upload/detach commands, never free-form edits.
  media_refs: string[];
  expiry_date?: string | null;
  expired: boolean;
  active: boolean;
}

// A reusable task definition from the owner-curated catalogue. Mirrors
// TaskCatalogueItem.to_dict(). Trigger rules are carried opaquely: the panel
// does not edit them in v1 (triggers are a separate concern), but it must
// preserve them verbatim on update so an edit never drops them.
export interface CatalogueTaskRecord {
  id: string;
  title: string;
  description?: string | null;
  system_refs: string[];
  equipment_refs: string[];
  inventory_refs: string[];
  required_skills: string[];
  estimated_duration_minutes?: number | null;
  procedure?: string | null;
  safety_notes?: string | null;
  default_verifier?: string | null;
  trigger_rules: Record<string, unknown>[];
  last_completed_at_utc?: string | null;
  active: boolean;
  owner_curated: boolean;
}

// Crew member. Mirrors CrewMember.to_dict(). `role` drives who may verify work
// onboard; the catalogue's default verifier references a crew member by id.
export interface CrewRecord {
  id: string;
  name: string;
  role: string;
  skills: string[];
  active: boolean;
}

// Immutable maintenance log entry. Mirrors MaintenanceLogEntry.to_dict(). The
// panel reads only the slice it needs to surface a "last completed" summary;
// the backend remains the source of truth for the full record.
export interface MaintenanceLogRecord {
  id: string;
  catalogue_task_id: string;
  work_item_id: string;
  verified_by: string;
  completed_by?: string | null;
  completed_at_utc: string;
  completed_at_local: string;
  timezone_at_completion: string;
  notes?: string | null;
}

export interface VesselRecord {
  id: string;
  name: string;
  home_port?: string | null;
  current_timezone?: string | null;
  default_timezone?: string | null;
}

// Metadata for an uploaded photo/PDF blob. Mirrors the backend document dict
// (build_document_record). The blob itself lives on disk under `stored_filename`
// and is served by the authenticated media view, addressed by opaque `id` (never
// by filename). `kind` is "image" (renderable inline) or "document" (PDF/other).
export interface DocumentRecord {
  id: string;
  filename: string;
  stored_filename: string;
  content_type: string;
  size: number;
  sha256: string;
  kind: string;
  target_type: string;
  target_id: string;
  created_at_utc: string;
  created_at_local: string;
  timezone_at_event: string;
}

// Derived (not a backend record): a media ref resolved for display. The shell
// joins a target's `media_refs` to the bootstrap `documents` map and attaches a
// signed, short-lived URL (null while the signature is still being fetched, so
// the strip can show a placeholder rather than a broken/401 image).
export interface ResolvedMedia {
  id: string;
  filename: string;
  kind: string;
  url: string | null;
}

// A quantity of an inventory item consumed by work. Mirrors InventoryUsage;
// quantity is a string to preserve Decimal precision.
export interface InventoryUsageRecord {
  inventory_id: string;
  quantity: string;
}

// An instantiated unit of work. Mirrors WorkItem.to_dict(). The `status` is one
// of WorkItemStatus; `assigned_to`/`verified_by` reference crew by stable id.
// Active work lives on the board; verification turns it into an immutable log
// entry (the backend remains the source of truth for lifecycle rules).
export interface WorkItemRecord {
  id: string;
  catalogue_task_id: string;
  status: string;
  trigger_source: string;
  trigger_key?: string | null;
  operational_context_id?: string | null;
  title?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  created_at_utc?: string | null;
  started_at_utc?: string | null;
  finished_at_utc?: string | null;
  submitted_for_review_at_utc?: string | null;
  verified_by?: string | null;
  verified_at_utc?: string | null;
  timezone_at_creation: string;
  timezone_at_completion?: string | null;
  completion_notes?: string | null;
  block_reason?: string | null;
  evidence_refs: string[];
  inventory_used: InventoryUsageRecord[];
  meter_readings: Record<string, unknown>;
}

export type RecordMap<T> = Record<string, T>;

// Derived (not a backend record): a compact summary of the most recent verified
// completion of a catalogue task, resolved by the shell from the maintenance log
// + crew. The date is the stored local string captured at completion time and is
// shown verbatim — never re-derived from UTC (history must stay stable across
// vessel timezone changes).
export interface CatalogueLastCompleted {
  date: string;
  verifierName: string | null;
  notes: string | null;
}

export interface BootstrapResult {
  entry_id: string;
  vessel: VesselRecord;
  active_timezone: string;
  schema_version: number;
  collections: {
    systems: RecordMap<SystemRecord>;
    equipment: RecordMap<EquipmentRecord>;
    inventory: RecordMap<InventoryRecord>;
    task_catalogue: RecordMap<CatalogueTaskRecord>;
    work_items: RecordMap<WorkItemRecord>;
    maintenance_log: RecordMap<MaintenanceLogRecord>;
    crew: RecordMap<CrewRecord>;
  };
  // Document metadata (photos/PDFs), keyed by opaque id. Read-only here: the
  // panel resolves a record's media_refs against this map; uploads/detaches go
  // through the dedicated media commands.
  documents: RecordMap<DocumentRecord>;
  counts: Record<string, number>;
}

export interface ChangeEvent {
  event: "changed";
  entry_id: string;
}

// A state-driven maintenance suggestion: an existing, active catalogue task
// proposed for instantiation because current vessel state calls for it (low
// stock or a calendar recurrence come due). Mirrors MaintenanceSuggestion
// .to_dict(). It carries the exact trigger context the panel echoes back to
// `apply_trigger` (source/key/context_id) so the backend instantiates precisely
// this task. `already_open` flags work already in flight, so the panel can show
// it without offering to create a duplicate. Suggestions never invent work — the
// backend matcher/dedup remains authoritative.
export interface SuggestionRecord {
  catalogue_task_id: string;
  title: string;
  source: string;
  key?: string | null;
  context_id?: string | null;
  context_label?: string | null;
  reason: string;
  dedup_key: string;
  already_open: boolean;
}

export interface SuggestionsResult {
  suggestions: SuggestionRecord[];
  count: number;
  open_count: number;
}

// Result of applying a trigger (an operational event or an accepted suggestion).
// `would_create`/`skipped_existing` list catalogue task ids the plan resolved;
// `created_work_item_ids` holds the new server-assigned ids on a real apply
// (empty on a dry run, since nothing is written). The panel never invents these
// ids — they come back from the backend.
export interface ApplyTriggerResult {
  dry_run: boolean;
  would_create: string[];
  skipped_existing: string[];
  created_work_item_ids: string[];
}

// Result of a media upload: the stored document metadata plus the (unsigned)
// serving URL the backend built for it. The panel refreshes the snapshot after
// an upload, so it reads media back from `documents`/`media_refs` rather than
// from this echo — the result mainly confirms the server-assigned id.
export interface MediaUploadResult {
  document: DocumentRecord;
  url: string;
  target_type: string;
  target_id: string;
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
