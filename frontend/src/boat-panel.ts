import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import { BoatApi } from "./api";
import "./systems-view";
import "./system-sheet";
import "./equipment-view";
import "./equipment-sheet";
import "./inventory-view";
import "./inventory-sheet";
import "./catalogue-view";
import "./catalogue-sheet";
import "./work-board-view";
import "./work-item-sheet";
import "./suggestions-view";
import { isLowStock } from "./inventory-view";
import type { SystemDraft } from "./system-sheet";
import type { EquipmentDraft } from "./equipment-sheet";
import type { InventoryDraft, InventoryAdjust } from "./inventory-sheet";
import type { CatalogueDraft } from "./catalogue-sheet";
import type { WorkAction } from "./work-item-sheet";
import type { MultiselectOption } from "./multiselect";
import {
  isWsError,
  type CatalogueLastCompleted,
  type CatalogueTaskRecord,
  type CrewRecord,
  type EquipmentRecord,
  type HomeAssistant,
  type InventoryRecord,
  type MaintenanceLogRecord,
  type PanelInfo,
  type SystemRecord,
  type SuggestionRecord,
  type UnsubscribeFunc,
  type VesselRecord,
  type WorkItemRecord,
} from "./types";

type Tab = "systems" | "equipment" | "inventory" | "tasks" | "work" | "ops" | "log";
type ListTab = "systems" | "equipment" | "inventory" | "tasks";

const TABS: { id: Tab; label: string }[] = [
  { id: "systems", label: "Systems" },
  { id: "equipment", label: "Equipment" },
  { id: "inventory", label: "Inventory" },
  { id: "tasks", label: "Tasks" },
  { id: "work", label: "Work" },
  { id: "ops", label: "Ops" },
  { id: "log", label: "Log" },
];

const LIST_TABS: ReadonlySet<Tab> = new Set<Tab>([
  "systems",
  "equipment",
  "inventory",
  "tasks",
]);

// Root custom element Home Assistant mounts as the panel. It owns the live
// vessel snapshot, drives the websocket API, and stays in sync via the
// `subscribe` push (re-reading the snapshot on every change — simple and
// always correct for the data volumes a single vessel holds). The per-entity
// list views and bottom-sheet forms are presentational; the shell owns all
// writes and the single `_run` mutation path (saving + error + refresh + close).
@customElement("boat-management-panel")
export class BoatManagementPanel extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      header {
        position: sticky;
        top: 0;
        z-index: 5;
        background: var(--app-header-background-color, var(--bm-surface));
        color: var(--app-header-text-color, var(--bm-text));
        padding: 14px 16px 10px;
        border-bottom: 1px solid var(--bm-divider);
      }
      .title {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.2;
      }
      .search {
        margin-top: 12px;
        position: relative;
      }
      .search input {
        width: 100%;
        padding: 11px 14px;
        border-radius: 999px;
        border: 1px solid var(--bm-divider);
        background: var(--bm-surface-2);
        color: var(--bm-text);
        font: inherit;
      }
      .search input:focus {
        outline: none;
        border-color: var(--bm-accent);
      }
      main {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      nav {
        position: sticky;
        bottom: 0;
        display: flex;
        height: var(--bm-nav-h);
        background: var(--bm-surface);
        border-top: 1px solid var(--bm-divider);
        padding-bottom: env(safe-area-inset-bottom);
      }
      nav button {
        flex: 1;
        border: none;
        background: none;
        color: var(--bm-text-dim);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.2px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 0;
      }
      nav button .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: transparent;
      }
      nav button[aria-selected="true"] {
        color: var(--bm-accent);
      }
      nav button[aria-selected="true"] .dot {
        background: var(--bm-accent);
      }
      .fab {
        position: fixed;
        right: 18px;
        bottom: calc(var(--bm-nav-h) + 18px + env(safe-area-inset-bottom));
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: none;
        background: var(--bm-accent);
        color: var(--bm-on-accent);
        font-size: 30px;
        line-height: 56px;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
        z-index: 10;
      }
      .loading {
        padding: 48px;
        text-align: center;
        color: var(--bm-text-dim);
      }
      .count {
        font-size: 13px;
      }
    `,
  ];

  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ type: Boolean }) narrow = false;
  @property({ attribute: false }) panel?: PanelInfo;

  @state() private _vessel: VesselRecord | null = null;
  @state() private _timezone = "";
  @state() private _systems: SystemRecord[] = [];
  @state() private _equipment: EquipmentRecord[] = [];
  @state() private _inventory: InventoryRecord[] = [];
  @state() private _catalogue: CatalogueTaskRecord[] = [];
  @state() private _crew: CrewRecord[] = [];
  @state() private _log: MaintenanceLogRecord[] = [];
  @state() private _work: WorkItemRecord[] = [];
  @state() private _suggestions: SuggestionRecord[] = [];
  @state() private _counts: Record<string, number> = {};
  @state() private _tab: Tab = "systems";
  @state() private _query = "";
  @state() private _loading = true;
  @state() private _error: string | null = null;

  // One sheet open at a time, keyed by the entity it edits. `_sheetRecord` is
  // null in create mode and the target record in edit mode. The work sheet is a
  // lifecycle surface rather than a list editor, so it joins the same machinery.
  @state() private _sheet: ListTab | "work" | null = null;
  @state() private _sheetRecord:
    | SystemRecord
    | EquipmentRecord
    | InventoryRecord
    | CatalogueTaskRecord
    | WorkItemRecord
    | null = null;
  @state() private _saving = false;
  @state() private _sheetError: string | null = null;

  private _api?: BoatApi;
  private _unsub?: UnsubscribeFunc;
  private _started = false;

  override willUpdate(_changed: Map<string, unknown>): void {
    // Start once the injected hass is available (it can arrive after the first
    // render tick depending on HA's mount order).
    if (!this._started && this.hass) {
      this._started = true;
      this._api = new BoatApi(this.hass);
      void this._start();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._unsub) {
      this._unsub();
      this._unsub = undefined;
    }
  }

  private async _start(): Promise<void> {
    await this._refresh();
    try {
      this._unsub = await this._api!.subscribe(() => void this._refresh());
    } catch (err) {
      // Push is a nice-to-have; the panel still works via manual refresh.
      // eslint-disable-next-line no-console
      console.warn("boat_management: subscribe failed", err);
    }
  }

  private async _refresh(): Promise<void> {
    try {
      const data = await this._api!.bootstrap();
      this._vessel = data.vessel;
      this._timezone = data.active_timezone;
      this._counts = data.counts;
      this._systems = Object.values(data.collections.systems);
      this._equipment = Object.values(data.collections.equipment);
      this._inventory = Object.values(data.collections.inventory);
      this._catalogue = Object.values(data.collections.task_catalogue);
      this._crew = Object.values(data.collections.crew);
      this._log = Object.values(data.collections.maintenance_log);
      this._work = Object.values(data.collections.work_items);
      this._error = null;
    } catch (err) {
      this._error = describe(err);
    } finally {
      this._loading = false;
    }
    // Suggestions are derived/auxiliary: fetch them separately so a failure here
    // (e.g. an older backend without the command) never blanks the panel. A stale
    // list is preferable to a broken shell.
    try {
      this._suggestions = (await this._api!.suggestions()).suggestions;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("boat_management: suggestions failed", err);
    }
  }

  // --- Rendering -----------------------------------------------------------
  override render() {
    const isList = LIST_TABS.has(this._tab);
    // The work board is not a searchable list, but it still instantiates work
    // via the FAB (create from a catalogue task).
    const showFab = (isList || this._tab === "work") && !this._loading;
    return html`
      <header>
        <div class="title ellipsis">${this._vessel?.name ?? "Boat"}</div>
        <div class="row" style="margin-top:4px">
          ${this._timezone
            ? html`<span class="chip">${this._timezone}</span>`
            : nothing}
          ${this._vessel?.home_port
            ? html`<span class="muted count">${this._vessel.home_port}</span>`
            : nothing}
        </div>
        ${isList
          ? html`<div class="search">
              <input
                type="search"
                placeholder=${`Search ${this._tab}`}
                .value=${this._query}
                @input=${(e: InputEvent) =>
                  (this._query = (e.target as HTMLInputElement).value)}
              />
            </div>`
          : nothing}
      </header>

      <main>
        ${this._error ? html`<div class="banner">${this._error}</div>` : nothing}
        ${this._loading
          ? html`<div class="loading">Loading vessel…</div>`
          : this._renderTab()}
      </main>

      ${showFab
        ? html`<button class="fab" title="Add" @click=${this._openCreate}>
            +
          </button>`
        : nothing}

      <nav>
        ${TABS.map(
          (tab) => html`<button
            aria-selected=${this._tab === tab.id}
            @click=${() => this._selectTab(tab.id)}
          >
            <span class="dot"></span>${tab.label}
          </button>`,
        )}
      </nav>

      ${this._renderSheet()}
    `;
  }

  private _renderTab() {
    switch (this._tab) {
      case "systems":
        return html`<boat-systems-view
          .systems=${this._filteredSystems()}
          @bm-edit=${this._onEditSystem}
        ></boat-systems-view>`;
      case "equipment":
        return html`<boat-equipment-view
          .equipment=${this._filteredEquipment()}
          .systemNames=${this._systemNames()}
          @bm-edit=${this._onEditEquipment}
        ></boat-equipment-view>`;
      case "inventory":
        return html`<boat-inventory-view
          .inventory=${this._filteredInventory()}
          @bm-edit=${this._onEditInventory}
        ></boat-inventory-view>`;
      case "tasks":
        return html`<boat-catalogue-view
          .tasks=${this._filteredCatalogue()}
          .systemNames=${this._systemNames()}
          .lastCompleted=${this._lastCompletedMap()}
          @bm-edit=${this._onEditTask}
        ></boat-catalogue-view>`;
      case "work":
        return html`<boat-work-board-view
          .items=${this._workForBoard()}
          .crewNames=${this._crewNames()}
          @bm-edit=${this._onEditWork}
        ></boat-work-board-view>`;
      case "ops":
        return html`<boat-suggestions-view
          .suggestions=${this._suggestions}
          @bm-apply=${this._onApplySuggestion}
        ></boat-suggestions-view>`;
      default: {
        const count = this._counts[this._tabCollection()] ?? 0;
        const label = TABS.find((t) => t.id === this._tab)!.label;
        return html`<div class="empty">
          ${label} coming soon.<br /><span class="count">${count} on record</span>
        </div>`;
      }
    }
  }

  private _renderSheet() {
    switch (this._sheet) {
      case "systems":
        return html`<boat-system-sheet
          .system=${this._sheetRecord as SystemRecord | null}
          .saving=${this._saving}
          .error=${this._sheetError}
          @bm-save=${this._onSystemSave}
          @bm-archive=${this._onSystemArchive}
          @bm-close=${this._closeSheet}
        ></boat-system-sheet>`;
      case "equipment":
        return html`<boat-equipment-sheet
          .equipment=${this._sheetRecord as EquipmentRecord | null}
          .systems=${this._systemOptions()}
          .inventoryOptions=${this._inventoryOptions()}
          .saving=${this._saving}
          .error=${this._sheetError}
          @bm-save=${this._onEquipmentSave}
          @bm-retire=${this._onEquipmentRetire}
          @bm-close=${this._closeSheet}
        ></boat-equipment-sheet>`;
      case "inventory":
        return html`<boat-inventory-sheet
          .inventory=${this._sheetRecord as InventoryRecord | null}
          .equipmentOptions=${this._equipmentOptions()}
          .saving=${this._saving}
          .error=${this._sheetError}
          @bm-save=${this._onInventorySave}
          @bm-adjust=${this._onInventoryAdjust}
          @bm-mark-expired=${this._onInventoryMarkExpired}
          @bm-close=${this._closeSheet}
        ></boat-inventory-sheet>`;
      case "tasks":
        return html`<boat-catalogue-sheet
          .task=${this._sheetRecord as CatalogueTaskRecord | null}
          .systems=${this._systemOptions()}
          .equipmentOptions=${this._equipmentOptions()}
          .inventoryOptions=${this._inventoryOptions()}
          .verifiers=${this._verifierOptions()}
          .lastCompleted=${this._lastCompletedFor(
            this._sheetRecord as CatalogueTaskRecord | null,
          )}
          .saving=${this._saving}
          .error=${this._sheetError}
          @bm-save=${this._onCatalogueSave}
          @bm-archive=${this._onCatalogueArchive}
          @bm-close=${this._closeSheet}
        ></boat-catalogue-sheet>`;
      case "work":
        return html`<boat-work-item-sheet
          .item=${this._sheetRecord as WorkItemRecord | null}
          .taskOptions=${this._taskOptions()}
          .crew=${this._crewOptions()}
          .verifiers=${this._verifierOptions()}
          .defaultVerifier=${this._defaultVerifierFor(
            this._sheetRecord as WorkItemRecord | null,
          )}
          .saving=${this._saving}
          .error=${this._sheetError}
          @bm-action=${this._onWorkAction}
          @bm-close=${this._closeSheet}
        ></boat-work-item-sheet>`;
      default:
        return nothing;
    }
  }

  // --- Derived data --------------------------------------------------------
  private _filteredSystems(): SystemRecord[] {
    const query = this._query.trim().toLowerCase();
    return this._systems
      .filter((s) => s.active)
      .filter((s) =>
        query
          ? `${s.name} ${s.category ?? ""} ${s.description ?? ""}`
              .toLowerCase()
              .includes(query)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _filteredEquipment(): EquipmentRecord[] {
    const query = this._query.trim().toLowerCase();
    return this._equipment
      .filter((e) => e.active)
      .filter((e) =>
        query
          ? `${e.name} ${e.manufacturer ?? ""} ${e.model ?? ""} ${
              e.category ?? ""
            } ${e.location ?? ""} ${e.serial_number ?? ""}`
              .toLowerCase()
              .includes(query)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _filteredInventory(): InventoryRecord[] {
    const query = this._query.trim().toLowerCase();
    return this._inventory
      .filter((i) => i.active)
      .filter((i) =>
        query
          ? `${i.name} ${i.part_number ?? ""} ${i.storage_location ?? ""} ${
              i.category ?? ""
            } ${i.unit}`
              .toLowerCase()
              .includes(query)
          : true,
      )
      .sort((a, b) => {
        // Surface anything needing attention (low/expired) first.
        const aFlag = (isLowStock(a) || a.expired) ? 0 : 1;
        const bFlag = (isLowStock(b) || b.expired) ? 0 : 1;
        return aFlag - bFlag || a.name.localeCompare(b.name);
      });
  }

  private _systemNames(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const s of this._systems) map[s.id] = s.name;
    return map;
  }

  private _filteredCatalogue(): CatalogueTaskRecord[] {
    const query = this._query.trim().toLowerCase();
    return this._catalogue
      .filter((t) => t.active)
      .filter((t) =>
        query
          ? `${t.title} ${t.description ?? ""} ${t.required_skills.join(" ")}`
              .toLowerCase()
              .includes(query)
          : true,
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  private _crewNames(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const c of this._crew) map[c.id] = c.name;
    return map;
  }

  // Verifier picker options: active crew, labelled with role so the skipper can
  // pick someone permitted to verify (the backend enforces the role at
  // verification time; the catalogue only records a default).
  private _verifierOptions(): MultiselectOption[] {
    return this._crew
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, name: `${c.name} (${c.role})` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Active crew as plain {id,name} for assignment/claim pickers.
  private _crewOptions(): MultiselectOption[] {
    return this._crew
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Active catalogue tasks for the create picker: work is only ever instantiated
  // from a known task (never invented), so the picker is the catalogue.
  private _taskOptions(): MultiselectOption[] {
    return this._catalogue
      .filter((t) => t.active)
      .map((t) => ({ id: t.id, name: t.title }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Stable board order: dated work first (soonest due first), then undated by
  // creation order, so the board does not reshuffle between refreshes.
  private _workForBoard(): WorkItemRecord[] {
    return [...this._work].sort((a, b) => {
      const ad = a.due_date ?? "";
      const bd = b.due_date ?? "";
      if (ad && bd && ad !== bd) return ad.localeCompare(bd);
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return (a.created_at_utc ?? "").localeCompare(b.created_at_utc ?? "");
    });
  }

  // The catalogue task's default verifier, used to pre-select the verifier on
  // review (the backend still enforces the verifier's role at verify time).
  private _defaultVerifierFor(item: WorkItemRecord | null): string | null {
    if (!item) return null;
    const task = this._catalogue.find((t) => t.id === item.catalogue_task_id);
    return task?.default_verifier ?? null;
  }

  // Most recent verified completion for a task, resolved from the immutable log.
  private _lastCompletedFor(
    task: CatalogueTaskRecord | null,
  ): CatalogueLastCompleted | null {
    if (!task) return null;
    const latest = this._log
      .filter((e) => e.catalogue_task_id === task.id)
      .sort((a, b) => b.completed_at_utc.localeCompare(a.completed_at_utc))[0];
    if (!latest) return null;
    const names = this._crewNames();
    return {
      date: latest.completed_at_local,
      verifierName: names[latest.verified_by] ?? null,
      notes: latest.notes ?? null,
    };
  }

  private _lastCompletedMap(): Record<string, CatalogueLastCompleted> {
    const out: Record<string, CatalogueLastCompleted> = {};
    for (const task of this._catalogue) {
      const summary = this._lastCompletedFor(task);
      if (summary) out[task.id] = summary;
    }
    return out;
  }

  private _systemOptions(): MultiselectOption[] {
    return this._systems
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _inventoryOptions(): MultiselectOption[] {
    return this._inventory
      .filter((i) => i.active)
      .map((i) => ({ id: i.id, name: i.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _equipmentOptions(): MultiselectOption[] {
    return this._equipment
      .filter((e) => e.active)
      .map((e) => ({ id: e.id, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _tabCollection(): string {
    return this._tab === "tasks"
      ? "task_catalogue"
      : this._tab === "log"
        ? "maintenance_log"
        : this._tab;
  }

  // --- Sheet lifecycle -----------------------------------------------------
  private _selectTab(tab: Tab): void {
    if (tab === this._tab) return;
    this._tab = tab;
    this._query = "";
  }

  private _openCreate(): void {
    // List tabs create their entity; the work board instantiates a work item.
    if (!LIST_TABS.has(this._tab) && this._tab !== "work") return;
    this._sheetRecord = null;
    this._sheetError = null;
    this._sheet = this._tab as ListTab | "work";
  }

  private _onEditSystem(e: CustomEvent<SystemRecord>): void {
    this._open("systems", e.detail);
  }

  private _onEditEquipment(e: CustomEvent<EquipmentRecord>): void {
    this._open("equipment", e.detail);
  }

  private _onEditInventory(e: CustomEvent<InventoryRecord>): void {
    this._open("inventory", e.detail);
  }

  private _onEditTask(e: CustomEvent<CatalogueTaskRecord>): void {
    this._open("tasks", e.detail);
  }

  private _onEditWork(e: CustomEvent<WorkItemRecord>): void {
    this._open("work", e.detail);
  }

  private _open(
    sheet: ListTab | "work",
    record:
      | SystemRecord
      | EquipmentRecord
      | InventoryRecord
      | CatalogueTaskRecord
      | WorkItemRecord,
  ): void {
    this._sheetRecord = record;
    this._sheetError = null;
    this._sheet = sheet;
  }

  private _closeSheet(): void {
    if (this._saving) return;
    this._sheet = null;
    this._sheetRecord = null;
  }

  // Single mutation path: flip saving, run the write, surface domain errors,
  // refresh the snapshot, then either close the sheet or re-point it to the
  // refreshed record (for in-place edits like an inventory adjust).
  private async _run(
    action: () => Promise<unknown>,
    keepOpenInventoryId?: string,
  ): Promise<void> {
    this._saving = true;
    this._sheetError = null;
    try {
      await action();
      await this._refresh();
      if (keepOpenInventoryId) {
        this._sheetRecord =
          this._inventory.find((i) => i.id === keepOpenInventoryId) ?? null;
        if (this._sheetRecord === null) this._sheet = null;
      } else {
        this._sheet = null;
        this._sheetRecord = null;
      }
    } catch (err) {
      this._sheetError = describe(err);
    } finally {
      this._saving = false;
    }
  }

  // --- System writes -------------------------------------------------------
  private _onSystemSave(e: CustomEvent<SystemDraft>): void {
    const d = e.detail;
    void this._run(() =>
      d.id
        ? this._api!.updateSystem(d.id, {
            name: d.name,
            category: d.category || null,
            description: d.description || null,
          })
        : this._api!.createSystem({
            name: d.name,
            category: d.category || undefined,
            description: d.description || undefined,
          }),
    );
  }

  private _onSystemArchive(e: CustomEvent<string>): void {
    void this._run(() => this._api!.archiveSystem(e.detail));
  }

  // --- Equipment writes ----------------------------------------------------
  private _onEquipmentSave(e: CustomEvent<EquipmentDraft>): void {
    const d = e.detail;
    const raw = d.maintenance_interval_days.trim();
    const parsed = raw === "" ? null : Number(raw);
    const interval = parsed != null && Number.isFinite(parsed) ? parsed : null;
    void this._run(() =>
      d.id
        ? this._api!.updateEquipment(d.id, {
            name: d.name,
            system_id: d.system_id || null,
            category: d.category || null,
            manufacturer: d.manufacturer || null,
            model: d.model || null,
            serial_number: d.serial_number || null,
            location: d.location || null,
            installed_date: d.installed_date || null,
            commissioned_date: d.commissioned_date || null,
            maintenance_interval_days: interval,
            documentation_refs: d.documentation_refs,
            inventory_refs: d.inventory_refs,
          })
        : this._api!.createEquipment({
            name: d.name,
            system_id: d.system_id || undefined,
            category: d.category || undefined,
            manufacturer: d.manufacturer || undefined,
            model: d.model || undefined,
            serial_number: d.serial_number || undefined,
            location: d.location || undefined,
            installed_date: d.installed_date || undefined,
            commissioned_date: d.commissioned_date || undefined,
            maintenance_interval_days: interval ?? undefined,
            documentation_refs: d.documentation_refs,
            inventory_refs: d.inventory_refs,
          }),
    );
  }

  private _onEquipmentRetire(e: CustomEvent<string>): void {
    void this._run(() => this._api!.retireEquipment(e.detail));
  }

  // --- Inventory writes ----------------------------------------------------
  private _onInventorySave(e: CustomEvent<InventoryDraft>): void {
    const d = e.detail;
    void this._run(() =>
      d.id
        ? this._api!.updateInventoryItem(d.id, {
            name: d.name,
            unit: d.unit,
            category: d.category || null,
            part_number: d.part_number || null,
            storage_location: d.storage_location || null,
            minimum_stock: d.minimum_stock || null,
            reorder_level: d.reorder_level || null,
            expiry_date: d.expiry_date || null,
            equipment_refs: d.equipment_refs,
          })
        : this._api!.createInventoryItem({
            name: d.name,
            quantity: d.quantity,
            unit: d.unit,
            category: d.category || undefined,
            part_number: d.part_number || undefined,
            storage_location: d.storage_location || undefined,
            minimum_stock: d.minimum_stock || undefined,
            reorder_level: d.reorder_level || undefined,
            expiry_date: d.expiry_date || undefined,
            equipment_refs: d.equipment_refs,
          }),
    );
  }

  private _onInventoryAdjust(e: CustomEvent<InventoryAdjust>): void {
    const { id, delta } = e.detail;
    // Keep the sheet open and re-point it to the refreshed item so the live
    // quantity updates without losing the editing context.
    void this._run(
      () => this._api!.adjustInventoryQuantity(id, delta),
      id,
    );
  }

  private _onInventoryMarkExpired(e: CustomEvent<string>): void {
    const id = e.detail;
    void this._run(() => this._api!.markInventoryExpired(id), id);
  }

  // --- Catalogue writes ----------------------------------------------------
  private _onCatalogueSave(e: CustomEvent<CatalogueDraft>): void {
    const d = e.detail;
    const raw = d.estimated_duration_minutes.trim();
    const parsed = raw === "" ? null : Number(raw);
    const duration = parsed != null && Number.isFinite(parsed) ? parsed : null;
    void this._run(() =>
      d.id
        ? this._api!.updateCatalogueTask(d.id, {
            title: d.title,
            description: d.description || null,
            procedure: d.procedure || null,
            safety_notes: d.safety_notes || null,
            estimated_duration_minutes: duration,
            default_verifier: d.default_verifier || null,
            system_refs: d.system_refs,
            equipment_refs: d.equipment_refs,
            inventory_refs: d.inventory_refs,
            required_skills: d.required_skills,
          })
        : this._api!.createCatalogueTask({
            title: d.title,
            description: d.description || undefined,
            procedure: d.procedure || undefined,
            safety_notes: d.safety_notes || undefined,
            estimated_duration_minutes: duration ?? undefined,
            default_verifier: d.default_verifier || undefined,
            system_refs: d.system_refs,
            equipment_refs: d.equipment_refs,
            inventory_refs: d.inventory_refs,
            required_skills: d.required_skills,
          }),
    );
  }

  private _onCatalogueArchive(e: CustomEvent<string>): void {
    void this._run(() => this._api!.archiveCatalogueTask(e.detail));
  }

  // --- Work item writes ----------------------------------------------------
  // One discriminated event covers the whole lifecycle: map each intent onto its
  // command and run it through the single mutation path (write, refresh, close).
  // The backend validates every transition, role, and reference; this only maps.
  private _onWorkAction(e: CustomEvent<WorkAction>): void {
    const a = e.detail;
    const api = this._api!;
    switch (a.kind) {
      case "create":
        void this._run(() =>
          api.createWorkItem({
            catalogue_task_id: a.catalogue_task_id,
            title: a.title,
            assigned_to: a.assigned_to,
            due_date: a.due_date,
          }),
        );
        return;
      case "claim":
        void this._run(() => api.claimWorkItem(a.id, a.crew_id));
        return;
      case "start":
        void this._run(() => api.startWorkItem(a.id));
        return;
      case "submit":
        void this._run(() => api.submitForReview(a.id, a.completion_notes));
        return;
      case "block":
        void this._run(() => api.blockWorkItem(a.id, a.block_reason));
        return;
      case "defer":
        void this._run(() => api.deferWorkItem(a.id, a.reason));
        return;
      case "cancel":
        void this._run(() => api.cancelWorkItem(a.id, a.reason));
        return;
      case "unblock":
        void this._run(() => api.unblockWorkItem(a.id, a.target));
        return;
      case "reopen":
        void this._run(() => api.reopenWorkItem(a.id, a.reason));
        return;
      case "verify":
        void this._run(() =>
          api.verifyWorkItem(a.id, a.verified_by, a.notes),
        );
        return;
    }
  }

  // --- Suggestion writes ---------------------------------------------------
  // Applying a suggestion has no sheet: it instantiates work directly from the
  // suggestion's trigger context (echoed back verbatim so the backend targets
  // exactly this catalogue task). Errors surface in the main banner, which is
  // visible on this tab; a double-tap is safe because the backend dedups against
  // open work. After the write we refresh, so the applied suggestion flips to
  // "On board" (now represented by open work).
  private _onApplySuggestion(e: CustomEvent<SuggestionRecord>): void {
    void this._applySuggestion(e.detail);
  }

  private async _applySuggestion(s: SuggestionRecord): Promise<void> {
    try {
      await this._api!.applyTrigger({
        source: s.source,
        catalogue_task_id: s.catalogue_task_id,
        key: s.key ?? undefined,
        context_id: s.context_id ?? undefined,
      });
      await this._refresh();
    } catch (err) {
      this._error = describe(err);
    }
  }
}

function describe(err: unknown): string {
  if (isWsError(err)) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-management-panel": BoatManagementPanel;
  }
}
