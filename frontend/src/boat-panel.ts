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
import { isLowStock } from "./inventory-view";
import type { SystemDraft } from "./system-sheet";
import type { EquipmentDraft } from "./equipment-sheet";
import type { InventoryDraft, InventoryAdjust } from "./inventory-sheet";
import type { MultiselectOption } from "./multiselect";
import {
  isWsError,
  type EquipmentRecord,
  type HomeAssistant,
  type InventoryRecord,
  type PanelInfo,
  type SystemRecord,
  type UnsubscribeFunc,
  type VesselRecord,
} from "./types";

type Tab = "systems" | "equipment" | "inventory" | "tasks" | "log";
type ListTab = "systems" | "equipment" | "inventory";

const TABS: { id: Tab; label: string }[] = [
  { id: "systems", label: "Systems" },
  { id: "equipment", label: "Equipment" },
  { id: "inventory", label: "Inventory" },
  { id: "tasks", label: "Tasks" },
  { id: "log", label: "Log" },
];

const LIST_TABS: ReadonlySet<Tab> = new Set<Tab>([
  "systems",
  "equipment",
  "inventory",
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
  @state() private _counts: Record<string, number> = {};
  @state() private _tab: Tab = "systems";
  @state() private _query = "";
  @state() private _loading = true;
  @state() private _error: string | null = null;

  // One sheet open at a time, keyed by the entity it edits. `_sheetRecord` is
  // null in create mode and the target record in edit mode.
  @state() private _sheet: ListTab | null = null;
  @state() private _sheetRecord:
    | SystemRecord
    | EquipmentRecord
    | InventoryRecord
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
      this._error = null;
    } catch (err) {
      this._error = describe(err);
    } finally {
      this._loading = false;
    }
  }

  // --- Rendering -----------------------------------------------------------
  override render() {
    const isList = LIST_TABS.has(this._tab);
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

      ${isList && !this._loading
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
    if (!LIST_TABS.has(this._tab)) return;
    this._sheetRecord = null;
    this._sheetError = null;
    this._sheet = this._tab as ListTab;
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

  private _open(
    sheet: ListTab,
    record: SystemRecord | EquipmentRecord | InventoryRecord,
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
