import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import "./multiselect";
import "./media-capture";
import type { MultiselectOption } from "./multiselect";
import type { InventoryRecord, ResolvedMedia } from "./types";

export interface InventoryDraft {
  id?: string;
  name: string;
  quantity: string; // create only; ignored on edit (use adjust)
  unit: string;
  category: string;
  part_number: string;
  storage_location: string;
  minimum_stock: string;
  reorder_level: string;
  expiry_date: string;
  equipment_refs: string[];
}

export interface InventoryAdjust {
  id: string;
  delta: string;
}

// Bottom-sheet form for inventory. Presentational: seeds from `inventory`
// (null => create) and emits intent. Quantity is settable directly only on
// create; on an existing item it is read-only and changes flow through
// `bm-adjust` (a signed delta) so every stock correction is audited (AGENTS.md).
// The shell re-points `inventory` to the refreshed record after an adjust
// without closing the sheet, so the live quantity reflects the server.
@customElement("boat-inventory-sheet")
export class BoatInventorySheet extends LitElement {
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
      .stock {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 12px;
        background: var(--bm-surface-2);
        margin-bottom: 14px;
      }
      .stock .label {
        font-size: 13px;
        color: var(--bm-text-dim);
      }
      .stock .big {
        font-size: 22px;
        font-weight: 700;
      }
      .stepctl {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .stepctl button {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        border: 1px solid var(--bm-divider);
        background: var(--bm-surface);
        color: var(--bm-text);
        font-size: 22px;
        line-height: 1;
      }
      .stepctl input {
        width: 64px;
        text-align: center;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid var(--bm-divider);
        background: var(--bm-surface);
        color: var(--bm-text);
        font: inherit;
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
  @property({ attribute: false }) inventory: InventoryRecord | null = null;
  @property({ attribute: false }) equipmentOptions: MultiselectOption[] = [];
  // Attached photos/PDFs resolved (with signed URLs) by the shell. Editable only
  // in edit mode: a new item has no server id to attach to yet.
  @property({ attribute: false }) media: ResolvedMedia[] = [];
  // True when a nested create sheet sits above this one: stay mounted (preserve
  // the draft) but hidden.
  @property({ type: Boolean }) behind = false;
  // One-shot delivery of a freshly-created equipment id to auto-link here. The
  // monotonic token guards against re-applying the same injection on re-render.
  @property({ attribute: false }) addEquipmentRef: {
    token: number;
    id: string;
  } | null = null;
  @property({ type: Boolean }) saving = false;
  @property() error: string | null = null;

  @state() private _name = "";
  @state() private _quantity = "";
  @state() private _unit = "ea";
  @state() private _category = "";
  @state() private _partNumber = "";
  @state() private _storage = "";
  @state() private _minimum = "";
  @state() private _reorder = "";
  @state() private _expiry = "";
  @state() private _equipmentRefs: string[] = [];
  @state() private _amount = "1";

  // Only reseed when the *identity* changes, so an adjust-driven refresh of the
  // same item (which keeps the sheet open) does not clobber in-flight edits to
  // other fields.
  private _seeded = false;
  private _seededId: string | null = null;
  // Token of the last applied equipment-ref injection (see `addEquipmentRef`).
  private _injectedToken = -1;

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("inventory")) {
      const id = this.inventory?.id ?? null;
      if (!this._seeded || id !== this._seededId) {
        this._seed();
        this._seeded = true;
        this._seededId = id;
      }
    }
    // A nested equipment create just completed: link the new equipment here and
    // select it. Guarded by the token so a later re-render never re-injects.
    if (changed.has("addEquipmentRef")) {
      const inj = this.addEquipmentRef;
      if (inj && inj.token !== this._injectedToken) {
        this._injectedToken = inj.token;
        if (!this._equipmentRefs.includes(inj.id)) {
          this._equipmentRefs = [...this._equipmentRefs, inj.id];
        }
      }
    }
  }

  private _seed(): void {
    const item = this.inventory;
    this._name = item?.name ?? "";
    this._quantity = item ? item.quantity : "";
    this._unit = item?.unit ?? "ea";
    this._category = item?.category ?? "";
    this._partNumber = item?.part_number ?? "";
    this._storage = item?.storage_location ?? "";
    this._minimum = item?.minimum_stock ?? "";
    this._reorder = item?.reorder_level ?? "";
    this._expiry = item?.expiry_date ?? "";
    this._equipmentRefs = item ? [...item.equipment_refs] : [];
    this._amount = "1";
  }

  override render() {
    const editing = !!this.inventory;
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
        <h2>${editing ? "Edit inventory" : "Add inventory"}</h2>
        ${this.error ? html`<div class="banner">${this.error}</div>` : nothing}

        <div class="field">
          <label for="name">Name</label>
          <input
            id="name"
            .value=${this._name}
            placeholder="e.g. Raw water impeller"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._name = (e.target as HTMLInputElement).value)}
          />
        </div>

        ${editing ? this._renderStepper() : this._renderCreateQuantity()}

        <div class="two">
          ${editing ? this._unitField() : nothing}
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
        </div>

        <div class="two">
          <div class="field">
            <label for="part">Part number</label>
            <input
              id="part"
              .value=${this._partNumber}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._partNumber = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="storage">Storage location</label>
            <input
              id="storage"
              .value=${this._storage}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._storage = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="two">
          <div class="field">
            <label for="minimum">Minimum stock</label>
            <input
              id="minimum"
              type="number"
              min="0"
              inputmode="decimal"
              .value=${this._minimum}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._minimum = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="reorder">Reorder level</label>
            <input
              id="reorder"
              type="number"
              min="0"
              inputmode="decimal"
              .value=${this._reorder}
              placeholder="optional"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._reorder = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="field">
          <label for="expiry">Expiry date</label>
          <input
            id="expiry"
            type="date"
            .value=${this._expiry}
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._expiry = (e.target as HTMLInputElement).value)}
          />
        </div>

        <boat-multiselect
          label="Used by equipment"
          .options=${this.equipmentOptions}
          .selected=${this._equipmentRefs}
          ?disabled=${this.saving}
          @bm-change=${(e: CustomEvent<string[]>) =>
            (this._equipmentRefs = e.detail)}
        ></boat-multiselect>
        <!-- Inline nested create: spawn an equipment sheet, then auto-link the
             new item here on completion (via addEquipmentRef). -->
        <button
          class="addnew"
          type="button"
          ?disabled=${this.saving}
          @click=${this._createEquipment}
        >
          + New equipment
        </button>

        <boat-media-capture
          label="Photos & documents"
          .media=${this.media}
          .canAdd=${editing}
          .disabled=${this.saving}
        ></boat-media-capture>

        <div class="actions">
          ${editing && !this.inventory?.expired
            ? html`<button
                class="btn danger"
                ?disabled=${this.saving}
                @click=${this._markExpired}
              >
                Mark expired
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

  private _renderCreateQuantity() {
    return html`<div class="two">
      <div class="field">
        <label for="qty">Quantity</label>
        <input
          id="qty"
          type="number"
          min="0"
          inputmode="decimal"
          .value=${this._quantity}
          placeholder="0"
          ?disabled=${this.saving}
          @input=${(e: InputEvent) =>
            (this._quantity = (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="field">
        <label for="unit">Unit</label>
        <input
          id="unit"
          .value=${this._unit}
          placeholder="ea"
          ?disabled=${this.saving}
          @input=${(e: InputEvent) =>
            (this._unit = (e.target as HTMLInputElement).value)}
        />
      </div>
    </div>`;
  }

  // Read-only current stock with a signed-delta stepper. Quantity is never set
  // directly on an existing item; adjustments are audited server-side.
  private _renderStepper() {
    return html`<div class="stock">
      <div>
        <div class="label">In stock</div>
        <div class="big">${this.inventory?.quantity} ${this._unit}</div>
      </div>
      <div class="stepctl">
        <button
          type="button"
          title="Decrease"
          ?disabled=${this.saving}
          @click=${() => this._adjust(-1)}
        >
          −
        </button>
        <input
          type="number"
          min="0"
          inputmode="decimal"
          .value=${this._amount}
          ?disabled=${this.saving}
          @input=${(e: InputEvent) =>
            (this._amount = (e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          title="Increase"
          ?disabled=${this.saving}
          @click=${() => this._adjust(1)}
        >
          +
        </button>
      </div>
    </div>`;
  }

  private _unitField() {
    return html`<div class="field">
      <label for="unit">Unit</label>
      <input
        id="unit"
        .value=${this._unit}
        placeholder="ea"
        ?disabled=${this.saving}
        @input=${(e: InputEvent) =>
          (this._unit = (e.target as HTMLInputElement).value)}
      />
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

  // Request a nested equipment create from the shell. The shell pushes an
  // equipment sheet above this one and, on save, injects the new id back here.
  private _createEquipment(): void {
    this.dispatchEvent(
      new CustomEvent("bm-create-equipment", { bubbles: true, composed: true }),
    );
  }

  private _adjust(sign: 1 | -1): void {
    if (!this.inventory) return;
    const magnitude = Number(this._amount);
    if (!Number.isFinite(magnitude) || magnitude <= 0) return;
    const delta = String(sign * magnitude);
    this.dispatchEvent(
      new CustomEvent<InventoryAdjust>("bm-adjust", {
        detail: { id: this.inventory.id, delta },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _markExpired(): void {
    if (!this.inventory) return;
    this.dispatchEvent(
      new CustomEvent<string>("bm-mark-expired", {
        detail: this.inventory.id,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _save(): void {
    const draft: InventoryDraft = {
      id: this.inventory?.id,
      name: this._name.trim(),
      quantity: this._quantity.trim() || "0",
      unit: this._unit.trim() || "ea",
      category: this._category.trim(),
      part_number: this._partNumber.trim(),
      storage_location: this._storage.trim(),
      minimum_stock: this._minimum.trim(),
      reorder_level: this._reorder.trim(),
      expiry_date: this._expiry,
      equipment_refs: this._equipmentRefs,
    };
    this.dispatchEvent(
      new CustomEvent<InventoryDraft>("bm-save", {
        detail: draft,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-inventory-sheet": BoatInventorySheet;
  }
}
