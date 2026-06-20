import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import { BoatApi, mediaPath } from "./api";
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
import "./logbook-view";
import { isLowStock } from "./inventory-view";
import type { SystemDraft } from "./system-sheet";
import type { EquipmentDraft } from "./equipment-sheet";
import type { InventoryDraft, InventoryAdjust } from "./inventory-sheet";
import type { CatalogueDraft } from "./catalogue-sheet";
import type { WorkAction } from "./work-item-sheet";
import type { MediaPick } from "./media-capture";
import type { MultiselectOption } from "./multiselect";
import {
  isWsError,
  type CatalogueLastCompleted,
  type CatalogueTaskRecord,
  type CrewRecord,
  type DocumentRecord,
  type EquipmentRecord,
  type HomeAssistant,
  type InventoryRecord,
  type MaintenanceLogRecord,
  type PanelInfo,
  type RecordMap,
  type ResolvedMedia,
  type SystemRecord,
  type SuggestionRecord,
  type UnsubscribeFunc,
  type VesselRecord,
  type WorkItemRecord,
} from "./types";

// Two top-level modes drive the whole shell. "Work" is the operational front
// page (what needs doing); "Locker" is the registry of vessel stuff. Each mode
// owns a small set of sections shown as a segmented control, keeping the bottom
// nav to two large, unambiguous targets.
type Mode = "work" | "locker";
type WorkSection = "board" | "ops" | "log";
// A Locker section maps 1:1 onto a creatable registry entity, so it doubles as
// the sheet key when the FAB instantiates a new record.
type LockerSection = "inventory" | "equipment" | "systems" | "tasks";

const MODES: { id: Mode; label: string; icon: string }[] = [
  {
    id: "work",
    label: "Work",
    // mdi-wrench
    icon: "M22.7,19L13.6,9.9C14.5,7.6 14,4.9 12.1,3C10.1,1 7.1,0.6 4.7,1.7L9,6L6,9L1.6,4.7C0.4,7.1 0.9,10.1 2.9,12.1C4.8,14 7.5,14.5 9.8,13.6L18.9,22.7C19.3,23.1 19.9,23.1 20.3,22.7L22.6,20.4C23.1,20 23.1,19.3 22.7,19Z",
  },
  {
    id: "locker",
    label: "Locker",
    // mdi-package-variant-closed
    icon: "M21,16.5C21,16.88 20.79,17.21 20.47,17.38L12.57,21.82C12.41,21.94 12.21,22 12,22C11.79,22 11.59,21.94 11.43,21.82L3.53,17.38C3.21,17.21 3,16.88 3,16.5V7.5C3,7.12 3.21,6.79 3.53,6.62L11.43,2.18C11.59,2.06 11.79,2 12,2C12.21,2 12.41,2.06 12.57,2.18L20.47,6.62C20.79,6.79 21,7.12 21,7.5V16.5M12,4.15L6.04,7.5L12,10.85L17.96,7.5L12,4.15Z",
  },
];

const WORK_SECTIONS: { id: WorkSection; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "ops", label: "Ops" },
  { id: "log", label: "Log" },
];

const LOCKER_SECTIONS: { id: LockerSection; label: string }[] = [
  { id: "inventory", label: "Inventory" },
  { id: "equipment", label: "Equipment" },
  { id: "systems", label: "Systems" },
  { id: "tasks", label: "Tasks" },
];

// A single open bottom-sheet. Sheets form a stack so a create flow can spawn a
// nested create (inventory → equipment → system) without losing the parent's
// in-flight draft: every frame stays mounted (only the top is visible and
// interactive), so each sheet's internal form state survives a push/pop.
// `record` is null in create mode, the target record in edit mode. `saving` and
// `error` are per-frame so a nested child can fail without disturbing the parent
// beneath it. The inject fields carry a freshly-created child's server id back to
// the parent for one-shot auto-selection, guarded by a monotonic token so a
// re-render never re-injects the same id.
interface SheetFrame {
  kind: LockerSection | "work";
  record:
    | SystemRecord
    | EquipmentRecord
    | InventoryRecord
    | CatalogueTaskRecord
    | WorkItemRecord
    | null;
  saving: boolean;
  error: string | null;
  injectEquipmentRef?: { token: number; id: string };
  injectSystem?: { token: number; id: string };
}

// Root custom element Home Assistant mounts as the panel. It owns the live
// vessel snapshot, drives the websocket API, and stays in sync via the
// `subscribe` push (re-reading the snapshot on every change — simple and
// always correct for the data volumes a single vessel holds). The per-entity
// list views and bottom-sheet forms are presentational; the shell owns all
// writes and the single `_runFrame` mutation path (saving + error + refresh +
// complete) against the top of the sheet stack.
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
        /* Reserve space for the iOS status bar / notch in the companion app. */
        padding-top: env(safe-area-inset-top);
        border-bottom: 1px solid var(--bm-divider);
      }
      /* Toolbar row: menu icon on the left, vessel identity block on the right. */
      .header-toolbar {
        display: flex;
        align-items: center;
        min-height: 56px;
        padding: 0 8px;
      }
      /* 44 × 44 touch target matching HA's icon-button sizing. */
      .menu-btn {
        flex-shrink: 0;
        width: 44px;
        height: 44px;
        border: none;
        background: none;
        color: inherit;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .menu-btn:hover,
      .menu-btn:focus-visible {
        background: rgba(128, 128, 128, 0.15);
        outline: none;
      }
      .header-title {
        flex: 1;
        min-width: 0;
        padding: 4px 8px 4px 4px;
      }
      .title {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.2;
      }
      .search {
        padding: 0 16px 10px;
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
      /* Secondary navigation: section pills for the active mode. Horizontally
         scrollable so Locker's four sections never wrap or shrink the targets. */
      .segments {
        display: flex;
        gap: 8px;
        padding: 0 12px 10px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .segments::-webkit-scrollbar {
        display: none;
      }
      .segments button {
        flex: 0 0 auto;
        border: 1px solid var(--bm-divider);
        background: var(--bm-surface-2);
        color: var(--bm-text-dim);
        padding: 7px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }
      .segments button[aria-selected="true"] {
        background: var(--bm-accent);
        color: var(--bm-on-accent);
        border-color: var(--bm-accent);
      }
      main {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      main.locked {
        overflow: hidden;
        touch-action: none;
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
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.2px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 0;
      }
      nav button svg {
        opacity: 0.85;
      }
      nav button[aria-selected="true"] {
        color: var(--bm-accent);
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
  // Document metadata (photos/PDFs) keyed by id, plus the config-entry id needed
  // to build media-view paths. Both come from bootstrap and feed media resolution.
  @state() private _documents: RecordMap<DocumentRecord> = {};
  @state() private _entryId = "";
  // Cache of signed, short-lived media URLs keyed by document id, populated
  // lazily as media becomes visible (the view requires auth, so a plain <img>
  // needs a signed path). `_signing` dedups concurrent in-flight sign requests.
  @state() private _signedUrls: Record<string, string> = {};
  private _signing = new Set<string>();
  @state() private _mode: Mode = "work";
  // Section is tracked per mode so switching modes returns you to where you
  // were rather than resetting to a default each time.
  @state() private _workSection: WorkSection = "board";
  @state() private _lockerSection: LockerSection = "inventory";
  @state() private _query = "";
  @state() private _loading = true;
  @state() private _error: string | null = null;

  // Stack of open bottom-sheets. Empty => nothing open; the last frame is the
  // visible, interactive sheet, and every frame beneath it stays mounted (its
  // form state preserved) but hidden. A nested create pushes a frame and pops it
  // on completion, injecting the new id into the parent beneath. The work sheet
  // is a lifecycle surface rather than a list editor, so it joins the same stack.
  @state() private _stack: SheetFrame[] = [];
  // Monotonic source for one-shot child-id injection tokens (see SheetFrame).
  private _injectToken = 0;

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
    // Whenever the open sheet or the document set changes, make sure the media
    // visible in the top frame has a signed URL (fetched lazily, cached).
    if (_changed.has("_stack") || _changed.has("_documents")) {
      this._ensureSignedForTop();
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
      this._entryId = data.entry_id;
      this._systems = Object.values(data.collections.systems);
      this._equipment = Object.values(data.collections.equipment);
      this._inventory = Object.values(data.collections.inventory);
      this._catalogue = Object.values(data.collections.task_catalogue);
      this._crew = Object.values(data.collections.crew);
      this._log = Object.values(data.collections.maintenance_log);
      this._work = Object.values(data.collections.work_items);
      // Documents drive media resolution; default defensively so an older
      // backend without the field never breaks the shell.
      this._documents = data.documents ?? {};
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
    const sections = this._mode === "work" ? WORK_SECTIONS : LOCKER_SECTIONS;
    const active = this._activeSection();
    // Search only applies to the Locker registries (all searchable lists); the
    // Work sections (board/ops/log) are not text-filtered.
    const showSearch = this._mode === "locker";
    const showFab = !this._loading && this._createSheet() !== null;
    return html`
      <header>
        <div class="header-toolbar">
          <!-- Hamburger / sidebar-toggle button. Fires the standard HA event so
               both the web browser and companion-app sidebar open reliably. -->
          <button
            class="menu-btn"
            aria-label="Open navigation menu"
            @click=${this._openMenu}
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z" />
            </svg>
          </button>
          <div class="header-title">
            <div class="title ellipsis">${this._vessel?.name ?? "Boat"}</div>
            <div class="row" style="margin-top:4px">
              ${this._timezone
                ? html`<span class="chip">${this._timezone}</span>`
                : nothing}
              ${this._vessel?.home_port
                ? html`<span class="muted count"
                    >${this._vessel.home_port}</span
                  >`
                : nothing}
            </div>
          </div>
        </div>
        <div class="segments" role="tablist">
          ${sections.map(
            (section) => html`<button
              role="tab"
              data-section=${section.id}
              aria-selected=${active === section.id}
              @click=${() => this._selectSection(section.id)}
            >
              ${section.label}
            </button>`,
          )}
        </div>
        ${showSearch
          ? html`<div class="search">
              <input
                type="search"
                placeholder=${`Search ${this._lockerSection}`}
                .value=${this._query}
                @input=${(e: InputEvent) =>
                  (this._query = (e.target as HTMLInputElement).value)}
              />
            </div>`
          : nothing}
      </header>

      <main class=${this._stack.length > 0 ? "locked" : ""}>
        ${this._error ? html`<div class="banner">${this._error}</div>` : nothing}
        ${this._loading
          ? html`<div class="loading">Loading vessel…</div>`
          : this._renderSection()}
      </main>

      ${showFab
        ? html`<button class="fab" title="Add" @click=${this._openCreate}>
            +
          </button>`
        : nothing}

      <nav>
        ${MODES.map(
          (mode) => html`<button
            data-mode=${mode.id}
            aria-selected=${this._mode === mode.id}
            @click=${() => this._selectMode(mode.id)}
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d=${mode.icon} />
            </svg>
            ${mode.label}
          </button>`,
        )}
      </nav>

      ${this._renderSheet()}
    `;
  }

  private _renderSection() {
    if (this._mode === "work") {
      switch (this._workSection) {
        case "board":
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
        case "log":
          return html`<boat-logbook-view
            .entries=${this._logForView()}
            .taskTitles=${this._taskTitles()}
            .crewNames=${this._crewNames()}
          ></boat-logbook-view>`;
      }
    }
    switch (this._lockerSection) {
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
    }
  }

  // Render every frame in stack order. Lit reconciles by position, so frames
  // beneath the top keep their element instances (and thus their in-flight form
  // state) across a push/pop. Only the last frame is the top: it is visible and
  // interactive; the rest are flagged `behind` (scrim hidden) so a nested create
  // never double-dims or leaks clicks to a parent. Because lower sheets are not
  // interactive, every sheet event necessarily originates from the top frame —
  // which is why the handlers below always act on it.
  private _renderSheet() {
    const top = this._stack.length - 1;
    return this._stack.map((frame, i) => this._renderFrame(frame, i === top));
  }

  private _renderFrame(frame: SheetFrame, isTop: boolean) {
    const behind = !isTop;
    switch (frame.kind) {
      case "systems":
        return html`<boat-system-sheet
          .system=${frame.record as SystemRecord | null}
          .saving=${frame.saving}
          .error=${frame.error}
          @bm-save=${this._onSystemSave}
          @bm-archive=${this._onSystemArchive}
          @bm-close=${this._closeTop}
        ></boat-system-sheet>`;
      case "equipment":
        return html`<boat-equipment-sheet
          .equipment=${frame.record as EquipmentRecord | null}
          .systems=${this._systemOptions()}
          .inventoryOptions=${this._inventoryOptions()}
          .media=${this._resolveMedia(frame.record as EquipmentRecord | null)}
          .behind=${behind}
          .setSystem=${frame.injectSystem ?? null}
          .saving=${frame.saving}
          .error=${frame.error}
          @bm-save=${this._onEquipmentSave}
          @bm-retire=${this._onEquipmentRetire}
          @bm-create-system=${this._onCreateSystem}
          @bm-media-pick=${this._onMediaPick}
          @bm-media-remove=${this._onMediaRemove}
          @bm-close=${this._closeTop}
        ></boat-equipment-sheet>`;
      case "inventory":
        return html`<boat-inventory-sheet
          .inventory=${frame.record as InventoryRecord | null}
          .equipmentOptions=${this._equipmentOptions()}
          .media=${this._resolveMedia(frame.record as InventoryRecord | null)}
          .behind=${behind}
          .addEquipmentRef=${frame.injectEquipmentRef ?? null}
          .saving=${frame.saving}
          .error=${frame.error}
          @bm-save=${this._onInventorySave}
          @bm-adjust=${this._onInventoryAdjust}
          @bm-mark-expired=${this._onInventoryMarkExpired}
          @bm-create-equipment=${this._onCreateEquipment}
          @bm-media-pick=${this._onMediaPick}
          @bm-media-remove=${this._onMediaRemove}
          @bm-close=${this._closeTop}
        ></boat-inventory-sheet>`;
      case "tasks":
        return html`<boat-catalogue-sheet
          .task=${frame.record as CatalogueTaskRecord | null}
          .systems=${this._systemOptions()}
          .equipmentOptions=${this._equipmentOptions()}
          .inventoryOptions=${this._inventoryOptions()}
          .verifiers=${this._verifierOptions()}
          .lastCompleted=${this._lastCompletedFor(
            frame.record as CatalogueTaskRecord | null,
          )}
          .saving=${frame.saving}
          .error=${frame.error}
          @bm-save=${this._onCatalogueSave}
          @bm-archive=${this._onCatalogueArchive}
          @bm-close=${this._closeTop}
        ></boat-catalogue-sheet>`;
      case "work":
        return html`<boat-work-item-sheet
          .item=${frame.record as WorkItemRecord | null}
          .taskOptions=${this._taskOptions()}
          .crew=${this._crewOptions()}
          .verifiers=${this._verifierOptions()}
          .defaultVerifier=${this._defaultVerifierFor(
            frame.record as WorkItemRecord | null,
          )}
          .saving=${frame.saving}
          .error=${frame.error}
          @bm-action=${this._onWorkAction}
          @bm-close=${this._closeTop}
        ></boat-work-item-sheet>`;
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

  // Catalogue task titles keyed by id, for the logbook to label entries (the
  // log stores the catalogue task id; the title is resolved for display).
  private _taskTitles(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const t of this._catalogue) map[t.id] = t.title;
    return map;
  }

  // Immutable log, newest first. The stored UTC instant orders entries; the
  // local string each entry carries is what gets displayed (never re-derived).
  private _logForView(): MaintenanceLogRecord[] {
    return [...this._log].sort((a, b) =>
      b.completed_at_utc.localeCompare(a.completed_at_utc),
    );
  }

  // The section currently shown for the active mode.
  private _activeSection(): WorkSection | LockerSection {
    return this._mode === "work" ? this._workSection : this._lockerSection;
  }

  // The sheet the FAB would open for the current section, or null when the
  // section has nothing to create (Ops applies suggestions; Log is immutable).
  private _createSheet(): LockerSection | "work" | null {
    if (this._mode === "locker") return this._lockerSection;
    return this._workSection === "board" ? "work" : null;
  }

  // --- Navigation ----------------------------------------------------------
  private _openMenu(): void {
    // Dispatch HA's standard sidebar toggle event. Bubbles up through the
    // shadow root so the companion app and browser builds both receive it.
    this.dispatchEvent(
      new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }),
    );
  }

  // --- Sheet lifecycle -----------------------------------------------------
  private _selectMode(mode: Mode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this._query = "";
  }

  private _selectSection(section: WorkSection | LockerSection): void {
    if (this._mode === "work") this._workSection = section as WorkSection;
    else this._lockerSection = section as LockerSection;
    this._query = "";
  }

  // The FAB opens a fresh top-level create, replacing any existing stack.
  private _openCreate(): void {
    const kind = this._createSheet();
    if (kind === null) return;
    this._stack = [{ kind, record: null, saving: false, error: null }];
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

  // Editing a record opens a fresh single-frame stack seeded with that record.
  private _open(
    kind: LockerSection | "work",
    record:
      | SystemRecord
      | EquipmentRecord
      | InventoryRecord
      | CatalogueTaskRecord
      | WorkItemRecord,
  ): void {
    this._stack = [{ kind, record, saving: false, error: null }];
  }

  // Push a nested create on top of the current top frame, preserving the
  // parent's in-flight draft (its element stays mounted beneath this one).
  private _spawn(kind: LockerSection | "work"): void {
    this._stack = [
      ...this._stack,
      { kind, record: null, saving: false, error: null },
    ];
  }

  // The inventory sheet asks for a nested equipment create; the equipment sheet
  // asks for a nested system create. Each spawns a child frame above it.
  private _onCreateEquipment(): void {
    this._spawn("equipment");
  }

  private _onCreateSystem(): void {
    this._spawn("systems");
  }

  // User-initiated close (Cancel / scrim): blocked while the top frame is
  // mid-write so we never abandon an in-flight request.
  private _closeTop(): void {
    const top = this._stack[this._stack.length - 1];
    if (top?.saving) return;
    this._popTop();
  }

  // Unconditional pop, used by completion handlers (the saving flag is still set
  // when a completion runs, so they must not route through the guarded close).
  private _popTop(): void {
    this._stack = this._stack.slice(0, -1);
  }

  private _nextToken(): number {
    return ++this._injectToken;
  }

  // Single mutation path against the top frame: flip its saving flag, run the
  // write, surface domain errors in-place (leaving the frame open so the message
  // is actionable), refresh the snapshot, then hand the server result to
  // `complete` (which pops/injects/re-points as appropriate). Lower frames are
  // untouched, so a nested child failing never disturbs the parent beneath it.
  private async _runFrame(
    action: () => Promise<unknown>,
    complete: (result: unknown) => void,
  ): Promise<void> {
    const frame = this._stack[this._stack.length - 1];
    if (!frame) return;
    frame.saving = true;
    frame.error = null;
    this._stack = [...this._stack];
    try {
      const result = await action();
      await this._refresh();
      complete(result);
    } catch (err) {
      frame.error = describe(err);
    } finally {
      frame.saving = false;
      this._stack = [...this._stack];
    }
  }

  // Completion for a nested-create child (system under equipment, equipment
  // under inventory): pop the child, and if the new top is the expected parent
  // kind, stamp the server-assigned id onto it for one-shot auto-selection. A
  // top-level create/edit has no matching parent beneath, so this just closes.
  private _finishChild(
    result: unknown,
    parentKind: LockerSection,
    inject: (parent: SheetFrame, id: string) => void,
  ): void {
    const next = this._stack.slice(0, -1);
    const parent = next[next.length - 1];
    const id = idOf(result);
    if (parent && parent.kind === parentKind && id) inject(parent, id);
    this._stack = next;
  }

  // Re-point the (kept-open) top frame to the refreshed record after an in-place
  // mutation (inventory adjust / mark-expired, or a media attach/detach) so the
  // sheet reflects the server without losing the editing context. Works for both
  // inventory and equipment frames; if the record vanished, close.
  private _repointTop(id: string): void {
    const frame = this._stack[this._stack.length - 1];
    if (!frame) return;
    const collection =
      frame.kind === "equipment"
        ? this._equipment
        : frame.kind === "inventory"
          ? this._inventory
          : null;
    if (!collection) return;
    const item = collection.find((r) => r.id === id) ?? null;
    if (item === null) {
      this._popTop();
    } else {
      frame.record = item;
      this._stack = [...this._stack];
    }
  }

  // Resolve a record's media_refs to display rows: join each opaque id to its
  // document metadata and attach the cached signed URL (null until it resolves,
  // so the strip shows a placeholder instead of a 401 image). A ref without
  // metadata (not yet in the refreshed snapshot) still renders by id.
  private _resolveMedia(record: { media_refs?: string[] } | null): ResolvedMedia[] {
    const refs = record?.media_refs ?? [];
    return refs.map((id) => {
      const doc = this._documents[id];
      return {
        id,
        filename: doc?.filename ?? id,
        kind: doc?.kind ?? "document",
        url: this._signedUrls[id] ?? null,
      };
    });
  }

  // Lazily sign the media URLs for the open frame's record. Signing is async and
  // per-document; results are cached in `_signedUrls` (which re-renders) and
  // de-duplicated via `_signing`. A failed sign is swallowed: the tile simply
  // stays a placeholder rather than breaking the sheet.
  private _ensureSignedForTop(): void {
    const frame = this._stack[this._stack.length - 1];
    if (!frame || !this._api || !this._entryId) return;
    const record = frame.record as { media_refs?: string[] } | null;
    for (const id of record?.media_refs ?? []) {
      if (this._signedUrls[id] || this._signing.has(id)) continue;
      this._signing.add(id);
      void this._api
        .signPath(mediaPath(this._entryId, id))
        .then((res) => {
          this._signedUrls = { ...this._signedUrls, [id]: res.path };
        })
        .catch(() => {
          // Leave the tile as a placeholder; signing can be retried on reopen.
        })
        .finally(() => {
          this._signing.delete(id);
        });
    }
  }

  // --- System writes -------------------------------------------------------
  private _onSystemSave(e: CustomEvent<SystemDraft>): void {
    const d = e.detail;
    void this._runFrame(
      () =>
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
      // Nested under an equipment create => auto-select the new system there;
      // otherwise this was a top-level system create/edit and just closes.
      (result) =>
        this._finishChild(result, "equipment", (parent, id) => {
          parent.injectSystem = { token: this._nextToken(), id };
        }),
    );
  }

  private _onSystemArchive(e: CustomEvent<string>): void {
    void this._runFrame(
      () => this._api!.archiveSystem(e.detail),
      () => this._popTop(),
    );
  }

  // --- Equipment writes ----------------------------------------------------
  private _onEquipmentSave(e: CustomEvent<EquipmentDraft>): void {
    const d = e.detail;
    const raw = d.maintenance_interval_days.trim();
    const parsed = raw === "" ? null : Number(raw);
    const interval = parsed != null && Number.isFinite(parsed) ? parsed : null;
    void this._runFrame(
      () =>
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
      // Nested under an inventory create => link the new equipment there;
      // otherwise this was a top-level equipment create/edit and just closes.
      (result) =>
        this._finishChild(result, "inventory", (parent, id) => {
          parent.injectEquipmentRef = { token: this._nextToken(), id };
        }),
    );
  }

  private _onEquipmentRetire(e: CustomEvent<string>): void {
    void this._runFrame(
      () => this._api!.retireEquipment(e.detail),
      () => this._popTop(),
    );
  }

  // --- Inventory writes ----------------------------------------------------
  private _onInventorySave(e: CustomEvent<InventoryDraft>): void {
    const d = e.detail;
    void this._runFrame(
      () =>
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
      // Inventory is the root of the nested-create chain, so a save just closes.
      () => this._popTop(),
    );
  }

  private _onInventoryAdjust(e: CustomEvent<InventoryAdjust>): void {
    const { id, delta } = e.detail;
    // Keep the sheet open and re-point it to the refreshed item so the live
    // quantity updates without losing the editing context.
    void this._runFrame(
      () => this._api!.adjustInventoryQuantity(id, delta),
      () => this._repointTop(id),
    );
  }

  private _onInventoryMarkExpired(e: CustomEvent<string>): void {
    const id = e.detail;
    void this._runFrame(
      () => this._api!.markInventoryExpired(id),
      () => this._repointTop(id),
    );
  }

  // --- Media writes --------------------------------------------------------
  // Attach/detach route off the open frame: its kind is the media target type
  // (equipment/inventory) and its record id the target id. Both keep the sheet
  // open and re-point it to the refreshed record so the new/removed tile shows
  // immediately. The capture child only offers these in edit mode, so a frame
  // with a persisted record is guaranteed here.
  private _mediaTarget(): { type: "equipment" | "inventory"; id: string } | null {
    const frame = this._stack[this._stack.length - 1];
    if (!frame || !frame.record) return null;
    if (frame.kind !== "equipment" && frame.kind !== "inventory") return null;
    return { type: frame.kind, id: frame.record.id };
  }

  private _onMediaPick(e: CustomEvent<MediaPick>): void {
    const target = this._mediaTarget();
    if (!target) return;
    const { filename, content_type, data } = e.detail;
    void this._runFrame(
      () =>
        this._api!.uploadMedia({
          target_type: target.type,
          target_id: target.id,
          filename,
          content_type,
          data,
        }),
      () => this._repointTop(target.id),
    );
  }

  private _onMediaRemove(e: CustomEvent<string>): void {
    const target = this._mediaTarget();
    if (!target) return;
    const documentId = e.detail;
    void this._runFrame(
      () => this._api!.detachMedia(documentId),
      () => this._repointTop(target.id),
    );
  }

  // --- Catalogue writes ----------------------------------------------------
  private _onCatalogueSave(e: CustomEvent<CatalogueDraft>): void {
    const d = e.detail;
    const raw = d.estimated_duration_minutes.trim();
    const parsed = raw === "" ? null : Number(raw);
    const duration = parsed != null && Number.isFinite(parsed) ? parsed : null;
    void this._runFrame(
      () =>
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
      () => this._popTop(),
    );
  }

  private _onCatalogueArchive(e: CustomEvent<string>): void {
    void this._runFrame(
      () => this._api!.archiveCatalogueTask(e.detail),
      () => this._popTop(),
    );
  }

  // --- Work item writes ----------------------------------------------------
  // One discriminated event covers the whole lifecycle: map each intent onto its
  // command and run it through the single mutation path (write, refresh, close).
  // The backend validates every transition, role, and reference; this only maps.
  // The work sheet is always a single top-level frame, so every action closes it.
  private _onWorkAction(e: CustomEvent<WorkAction>): void {
    const a = e.detail;
    const api = this._api!;
    const close = () => this._popTop();
    switch (a.kind) {
      case "create":
        void this._runFrame(
          () =>
            api.createWorkItem({
              catalogue_task_id: a.catalogue_task_id,
              title: a.title,
              assigned_to: a.assigned_to,
              due_date: a.due_date,
            }),
          close,
        );
        return;
      case "claim":
        void this._runFrame(() => api.claimWorkItem(a.id, a.crew_id), close);
        return;
      case "start":
        void this._runFrame(() => api.startWorkItem(a.id), close);
        return;
      case "submit":
        void this._runFrame(
          () => api.submitForReview(a.id, a.completion_notes),
          close,
        );
        return;
      case "block":
        void this._runFrame(
          () => api.blockWorkItem(a.id, a.block_reason),
          close,
        );
        return;
      case "defer":
        void this._runFrame(() => api.deferWorkItem(a.id, a.reason), close);
        return;
      case "cancel":
        void this._runFrame(() => api.cancelWorkItem(a.id, a.reason), close);
        return;
      case "unblock":
        void this._runFrame(() => api.unblockWorkItem(a.id, a.target), close);
        return;
      case "reopen":
        void this._runFrame(() => api.reopenWorkItem(a.id, a.reason), close);
        return;
      case "verify":
        void this._runFrame(
          () => api.verifyWorkItem(a.id, a.verified_by, a.notes),
          close,
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

// Pull the server-assigned id off a create/update result so a completed nested
// create can be auto-selected in its parent. Returns null for shapes without a
// string id (e.g. the verify command returns a log entry, never injected).
function idOf(result: unknown): string | null {
  if (result && typeof result === "object" && "id" in result) {
    const id = (result as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-management-panel": BoatManagementPanel;
  }
}
