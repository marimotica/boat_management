import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import "./chips-input";
import "./multiselect";
import type { MultiselectOption } from "./multiselect";
import type { CatalogueLastCompleted, CatalogueTaskRecord } from "./types";

export interface CatalogueDraft {
  id?: string;
  title: string;
  description: string;
  procedure: string;
  safety_notes: string;
  estimated_duration_minutes: string;
  default_verifier: string;
  system_refs: string[];
  equipment_refs: string[];
  inventory_refs: string[];
  required_skills: string[];
}

// Bottom-sheet form for creating/editing a catalogue task definition. Purely
// presentational: it seeds from `task` (null => create), collects input, and
// emits intent (`bm-save`, `bm-archive`, `bm-close`). All persistence and id
// assignment happen in the shell. References (systems/equipment/inventory) are
// picked by stable id from the supplied option lists; the default verifier is a
// crew id. Trigger rules are intentionally not edited here (a separate concern),
// so the shell carries them through untouched on update.
@customElement("boat-catalogue-sheet")
export class BoatCatalogueSheet extends LitElement {
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
      textarea {
        min-height: 64px;
        resize: vertical;
      }
      textarea.procedure {
        min-height: 120px;
      }
      .done {
        margin: 4px 0 16px;
        padding: 12px 14px;
        border-radius: 10px;
        background: var(--bm-surface-2);
        border: 1px solid var(--bm-divider);
        font-size: 13px;
      }
      .done .label {
        color: var(--bm-text-dim);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .done .notes {
        margin-top: 4px;
        color: var(--bm-text-dim);
        white-space: pre-wrap;
      }
      .actions {
        display: flex;
        gap: 10px;
        margin-top: 8px;
      }
      .actions .grow {
        flex: 1;
      }
    `,
  ];

  // null/undefined => create mode; a record => edit mode.
  @property({ attribute: false }) task: CatalogueTaskRecord | null = null;
  @property({ attribute: false }) systems: MultiselectOption[] = [];
  @property({ attribute: false }) equipmentOptions: MultiselectOption[] = [];
  @property({ attribute: false }) inventoryOptions: MultiselectOption[] = [];
  @property({ attribute: false }) verifiers: MultiselectOption[] = [];
  @property({ attribute: false }) lastCompleted: CatalogueLastCompleted | null =
    null;
  @property({ type: Boolean }) saving = false;
  @property() error: string | null = null;

  @state() private _title = "";
  @state() private _description = "";
  @state() private _procedure = "";
  @state() private _safety = "";
  @state() private _duration = "";
  @state() private _verifier = "";
  @state() private _systemRefs: string[] = [];
  @state() private _equipmentRefs: string[] = [];
  @state() private _inventoryRefs: string[] = [];
  @state() private _skills: string[] = [];

  override willUpdate(changed: Map<string, unknown>): void {
    // Seed inputs whenever the target record identity changes.
    if (changed.has("task")) {
      const task = this.task;
      this._title = task?.title ?? "";
      this._description = task?.description ?? "";
      this._procedure = task?.procedure ?? "";
      this._safety = task?.safety_notes ?? "";
      this._duration =
        task?.estimated_duration_minutes != null
          ? String(task.estimated_duration_minutes)
          : "";
      this._verifier = task?.default_verifier ?? "";
      this._systemRefs = task ? [...task.system_refs] : [];
      this._equipmentRefs = task ? [...task.equipment_refs] : [];
      this._inventoryRefs = task ? [...task.inventory_refs] : [];
      this._skills = task ? [...task.required_skills] : [];
    }
  }

  override render() {
    const editing = !!this.task;
    const canSave = this._title.trim().length > 0 && !this.saving;
    return html`<div class="scrim" @click=${this._onScrim}>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="grabber"></div>
        <h2>${editing ? "Edit task" : "Add task"}</h2>
        ${this.error ? html`<div class="banner">${this.error}</div>` : nothing}

        <div class="field">
          <label for="title">Title</label>
          <input
            id="title"
            .value=${this._title}
            placeholder="e.g. Replace raw-water impeller"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._title = (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="field">
          <label for="description">Description</label>
          <textarea
            id="description"
            .value=${this._description}
            placeholder="optional"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._description = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <boat-multiselect
          label="Systems"
          .options=${this.systems}
          .selected=${this._systemRefs}
          ?disabled=${this.saving}
          @bm-change=${(e: CustomEvent<string[]>) =>
            (this._systemRefs = e.detail)}
        ></boat-multiselect>

        <boat-multiselect
          label="Equipment"
          .options=${this.equipmentOptions}
          .selected=${this._equipmentRefs}
          ?disabled=${this.saving}
          @bm-change=${(e: CustomEvent<string[]>) =>
            (this._equipmentRefs = e.detail)}
        ></boat-multiselect>

        <boat-multiselect
          label="Inventory"
          .options=${this.inventoryOptions}
          .selected=${this._inventoryRefs}
          ?disabled=${this.saving}
          @bm-change=${(e: CustomEvent<string[]>) =>
            (this._inventoryRefs = e.detail)}
        ></boat-multiselect>

        <boat-chips-input
          label="Required skills"
          placeholder="Add a skill, then Enter"
          .values=${this._skills}
          ?disabled=${this.saving}
          @bm-change=${(e: CustomEvent<string[]>) => (this._skills = e.detail)}
        ></boat-chips-input>

        <div class="field">
          <label for="duration">Estimated duration (minutes)</label>
          <input
            id="duration"
            type="number"
            min="0"
            inputmode="numeric"
            .value=${this._duration}
            placeholder="optional"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._duration = (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="field">
          <label for="verifier">Default verifier</label>
          <select
            id="verifier"
            .value=${this._verifier}
            ?disabled=${this.saving}
            @change=${(e: Event) =>
              (this._verifier = (e.target as HTMLSelectElement).value)}
          >
            <option value="">Unassigned</option>
            ${this.verifiers.map(
              (crew) => html`<option
                value=${crew.id}
                ?selected=${crew.id === this._verifier}
              >
                ${crew.name}
              </option>`,
            )}
          </select>
        </div>

        <div class="field">
          <label for="procedure">Procedure</label>
          <textarea
            id="procedure"
            class="procedure"
            .value=${this._procedure}
            placeholder="Step-by-step procedure (optional)"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._procedure = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <div class="field">
          <label for="safety">Safety notes</label>
          <textarea
            id="safety"
            .value=${this._safety}
            placeholder="optional"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._safety = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        ${this.lastCompleted
          ? html`<div class="done">
              <div class="label">Last completed</div>
              <div>
                ${this.lastCompleted.date}${this.lastCompleted.verifierName
                  ? html` · verified by ${this.lastCompleted.verifierName}`
                  : nothing}
              </div>
              ${this.lastCompleted.notes
                ? html`<div class="notes">${this.lastCompleted.notes}</div>`
                : nothing}
            </div>`
          : nothing}

        <div class="actions">
          ${editing
            ? html`<button
                class="btn danger"
                ?disabled=${this.saving}
                @click=${this._archive}
              >
                Archive
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

  private _save(): void {
    const draft: CatalogueDraft = {
      id: this.task?.id,
      title: this._title.trim(),
      description: this._description.trim(),
      procedure: this._procedure.trim(),
      safety_notes: this._safety.trim(),
      estimated_duration_minutes: this._duration.trim(),
      default_verifier: this._verifier,
      system_refs: this._systemRefs,
      equipment_refs: this._equipmentRefs,
      inventory_refs: this._inventoryRefs,
      required_skills: this._skills,
    };
    this.dispatchEvent(
      new CustomEvent<CatalogueDraft>("bm-save", {
        detail: draft,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _archive(): void {
    if (!this.task) return;
    this.dispatchEvent(
      new CustomEvent<string>("bm-archive", {
        detail: this.task.id,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-catalogue-sheet": BoatCatalogueSheet;
  }
}
