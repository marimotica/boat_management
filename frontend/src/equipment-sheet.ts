import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import "./chips-input";
import "./multiselect";
import "./media-capture";
import type { MultiselectOption } from "./multiselect";
import type { EquipmentRecord, ResolvedMedia } from "./types";

export interface EquipmentDraft {
  id?: string;
  name: string;
  system_id: string;
  category: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  location: string;
  installed_date: string;
  commissioned_date: string;
  maintenance_interval_days: string;
  documentation_refs: string[];
  inventory_refs: string[];
}

// Bottom-sheet form for creating/editing equipment. Purely presentational: it
// seeds from `equipment` (null => create), collects input, and emits intent
// (`bm-save`, `bm-retire`, `bm-close`). All persistence and id assignment happen
// in the shell. Documentation references are opaque strings; inventory links are
// picked by stable id from `inventoryOptions`.
@customElement("boat-equipment-sheet")
export class BoatEquipmentSheet extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      .scrim {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: flex-end;
        z-index: 20;
      }
      /* A frame beneath a nested create stays mounted (so its form state is
         preserved) but hidden, so only the top sheet dims and takes input. */
      .scrim.behind {
        display: none;
      }
      .sheet {
        width: 100%;
        max-height: 92%;
        overflow-y: auto;
        background: var(--bm-surface);
        border-radius: 18px 18px 0 0;
        padding: 8px 18px calc(18px + env(safe-area-inset-bottom));
        animation: rise 0.18s ease-out;
      }
      @keyframes rise {
        from {
          transform: translateY(12%);
          opacity: 0.6;
        }
      }
      .grabber {
        width: 40px;
        height: 4px;
        border-radius: 2px;
        background: var(--bm-divider);
        margin: 8px auto 14px;
      }
      h2 {
        margin: 0 0 16px;
        font-size: 18px;
      }
      .two {
        display: flex;
        gap: 12px;
      }
      .two > * {
        flex: 1;
      }
      .actions {
        display: flex;
        gap: 10px;
        margin-top: 8px;
      }
      .actions .grow {
        flex: 1;
      }
      /* Subtle inline "create related record" affordance under a picker. */
      .addnew {
        background: none;
        border: none;
        color: var(--bm-accent);
        font-weight: 600;
        font-size: 13px;
        padding: 2px 2px 0;
        margin-bottom: 14px;
        align-self: flex-start;
      }
      .addnew:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ];

  // null/undefined => create mode; a record => edit mode.
  @property({ attribute: false }) equipment: EquipmentRecord | null = null;
  @property({ attribute: false }) systems: MultiselectOption[] = [];
  @property({ attribute: false }) inventoryOptions: MultiselectOption[] = [];
  // Attached photos/PDFs resolved (with signed URLs) by the shell. Editable only
  // in edit mode: a new item has no server id to attach to yet.
  @property({ attribute: false }) media: ResolvedMedia[] = [];
  // True when a nested create sheet sits above this one: stay mounted (preserve
  // the draft) but hidden.
  @property({ type: Boolean }) behind = false;
  // One-shot delivery of a freshly-created system id to select here. The
  // monotonic token guards against re-applying the same injection on re-render.
  @property({ attribute: false }) setSystem: {
    token: number;
    id: string;
  } | null = null;
  @property({ type: Boolean }) saving = false;
  @property() error: string | null = null;

  @state() private _name = "";
  @state() private _systemId = "";
  @state() private _category = "";
  @state() private _manufacturer = "";
  @state() private _model = "";
  @state() private _serial = "";
  @state() private _location = "";
  @state() private _installed = "";
  @state() private _commissioned = "";
  @state() private _interval = "";
  @state() private _docs: string[] = [];
  @state() private _inventoryRefs: string[] = [];

  // Token of the last applied system injection (see `setSystem`).
  private _injectedToken = -1;

  override willUpdate(changed: Map<string, unknown>): void {
    // Seed inputs whenever the target record identity changes.
    if (changed.has("equipment")) {
      const eq = this.equipment;
      this._name = eq?.name ?? "";
      this._systemId = eq?.system_id ?? "";
      this._category = eq?.category ?? "";
      this._manufacturer = eq?.manufacturer ?? "";
      this._model = eq?.model ?? "";
      this._serial = eq?.serial_number ?? "";
      this._location = eq?.location ?? "";
      this._installed = eq?.installed_date ?? "";
      this._commissioned = eq?.commissioned_date ?? "";
      this._interval =
        eq?.maintenance_interval_days != null
          ? String(eq.maintenance_interval_days)
          : "";
      this._docs = eq ? [...eq.documentation_refs] : [];
      this._inventoryRefs = eq ? [...eq.inventory_refs] : [];
    }
    // A nested system create just completed: select it here. Guarded by the
    // token so a later re-render never re-applies the same injection.
    if (changed.has("setSystem")) {
      const inj = this.setSystem;
      if (inj && inj.token !== this._injectedToken) {
        this._injectedToken = inj.token;
        this._systemId = inj.id;
      }
    }
  }

  override render() {
    const editing = !!this.equipment;
    const canSave = this._name.trim().length > 0 && !this.saving;
    return html`<div
      class=${this.behind ? "scrim behind" : "scrim"}
      @click=${this._onScrim}
    >
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="grabber"></div>
        <h2>${editing ? "Edit equipment" : "Add equipment"}</h2>
        ${this.error ? html`<div class="banner">${this.error}</div>` : nothing}

        <div class="field">
          <label for="name">Name</label>
          <input
            id="name"
            .value=${this._name}
            placeholder="e.g. Port engine"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._name = (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="field">
          <label for="system">System</label>
          <select
            id="system"
            .value=${this._systemId}
            ?disabled=${this.saving}
            @change=${(e: Event) =>
              (this._systemId = (e.target as HTMLSelectElement).value)}
          >
            <option value="">Unassigned</option>
            ${this.systems.map(
              (system) => html`<option
                value=${system.id}
                ?selected=${system.id === this._systemId}
              >
                ${system.name}
              </option>`,
            )}
          </select>
        </div>
        <!-- Inline nested create: spawn a system sheet, then auto-select the
             new system here on completion (via setSystem). -->
        <button
          class="addnew"
          type="button"
          ?disabled=${this.saving}
          @click=${this._createSystem}
        >
          + New system
        </button>

        <div class="two">
          <div class="field">
            <label for="manufacturer">Manufacturer</label>
            <input
              id="manufacturer"
              .value=${this._manufacturer}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._manufacturer = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="model">Model</label>
            <input
              id="model"
              .value=${this._model}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._model = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="two">
          <div class="field">
            <label for="category">Category</label>
            <input
              id="category"
              .value=${this._category}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._category = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="serial">Serial number</label>
            <input
              id="serial"
              .value=${this._serial}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._serial = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="field">
          <label for="location">Location</label>
          <input
            id="location"
            .value=${this._location}
            placeholder="e.g. Engine room, port side"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._location = (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="two">
          <div class="field">
            <label for="installed">Installed</label>
            <input
              id="installed"
              type="date"
              .value=${this._installed}
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._installed = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="commissioned">Commissioned</label>
            <input
              id="commissioned"
              type="date"
              .value=${this._commissioned}
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._commissioned = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="field">
          <label for="interval">Maintenance interval (days)</label>
          <input
            id="interval"
            type="number"
            min="0"
            inputmode="numeric"
            .value=${this._interval}
            placeholder="optional"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._interval = (e.target as HTMLInputElement).value)}
          />
        </div>

        <boat-chips-input
          label="Documentation references"
          .values=${this._docs}
          ?disabled=${this.saving}
          @bm-change=${(e: CustomEvent<string[]>) => (this._docs = e.detail)}
        ></boat-chips-input>

        <boat-multiselect
          label="Linked inventory"
          .options=${this.inventoryOptions}
          .selected=${this._inventoryRefs}
          ?disabled=${this.saving}
          @bm-change=${(e: CustomEvent<string[]>) =>
            (this._inventoryRefs = e.detail)}
        ></boat-multiselect>

        <boat-media-capture
          label="Photos & documents"
          .media=${this.media}
          .canAdd=${editing}
          .disabled=${this.saving}
        ></boat-media-capture>

        <div class="actions">
          ${editing
            ? html`<button
                class="btn danger"
                ?disabled=${this.saving}
                @click=${this._retire}
              >
                Retire
              </button>`
            : nothing}
          <span class="grow"></span>
          <button class="btn" ?disabled=${this.saving} @click=${this._close}>
            Cancel
          </button>
          <button class="btn primary" ?disabled=${!canSave} @click=${this._save}>
            ${this.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>`;
  }

  private _onScrim(): void {
    if (!this.saving) this._close();
  }

  private _close(): void {
    this.dispatchEvent(
      new CustomEvent("bm-close", { bubbles: true, composed: true }),
    );
  }

  // Request a nested system create from the shell. The shell pushes a system
  // sheet above this one and, on save, injects the new id back here.
  private _createSystem(): void {
    this.dispatchEvent(
      new CustomEvent("bm-create-system", { bubbles: true, composed: true }),
    );
  }

  private _save(): void {
    const draft: EquipmentDraft = {
      id: this.equipment?.id,
      name: this._name.trim(),
      system_id: this._systemId,
      category: this._category.trim(),
      manufacturer: this._manufacturer.trim(),
      model: this._model.trim(),
      serial_number: this._serial.trim(),
      location: this._location.trim(),
      installed_date: this._installed,
      commissioned_date: this._commissioned,
      maintenance_interval_days: this._interval.trim(),
      documentation_refs: this._docs,
      inventory_refs: this._inventoryRefs,
    };
    this.dispatchEvent(
      new CustomEvent<EquipmentDraft>("bm-save", {
        detail: draft,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _retire(): void {
    if (!this.equipment) return;
    this.dispatchEvent(
      new CustomEvent<string>("bm-retire", {
        detail: this.equipment.id,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-equipment-sheet": BoatEquipmentSheet;
  }
}
