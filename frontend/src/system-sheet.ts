import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { SystemRecord } from "./types";

export interface SystemDraft {
  id?: string;
  name: string;
  category: string;
  description: string;
}

// Bottom-sheet form used for both create and edit. The shell controls
// visibility and seeds `system` (null => create). All persistence happens in
// the shell via the API; this component only collects input and emits intent.
@customElement("boat-system-sheet")
export class BoatSystemSheet extends LitElement {
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
        max-height: 90%;
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
  @property({ attribute: false }) system: SystemRecord | null = null;
  @property({ type: Boolean }) saving = false;
  @property() error: string | null = null;

  @state() private _name = "";
  @state() private _category = "";
  @state() private _description = "";

  override willUpdate(changed: Map<string, unknown>): void {
    // Seed inputs whenever the target record identity changes.
    if (changed.has("system")) {
      this._name = this.system?.name ?? "";
      this._category = this.system?.category ?? "";
      this._description = this.system?.description ?? "";
    }
  }

  override render() {
    const editing = !!this.system;
    const canSave = this._name.trim().length > 0 && !this.saving;
    return html`<div class="scrim" @click=${this._onScrim}>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="grabber"></div>
        <h2>${editing ? "Edit system" : "Add system"}</h2>
        ${this.error
          ? html`<div class="banner">${this.error}</div>`
          : nothing}
        <div class="field">
          <label for="name">Name</label>
          <input
            id="name"
            .value=${this._name}
            placeholder="e.g. Propulsion"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._name = (e.target as HTMLInputElement).value)}
          />
        </div>
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
          <label for="desc">Description</label>
          <textarea
            id="desc"
            rows="2"
            .value=${this._description}
            placeholder="optional"
            ?disabled=${this.saving}
            @input=${(e: InputEvent) =>
              (this._description = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
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
          <button
            class="btn primary"
            ?disabled=${!canSave}
            @click=${this._save}
          >
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
    this.dispatchEvent(new CustomEvent("bm-close", { bubbles: true, composed: true }));
  }

  private _save(): void {
    const draft: SystemDraft = {
      id: this.system?.id,
      name: this._name.trim(),
      category: this._category.trim(),
      description: this._description.trim(),
    };
    this.dispatchEvent(
      new CustomEvent<SystemDraft>("bm-save", {
        detail: draft,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _archive(): void {
    if (!this.system) return;
    this.dispatchEvent(
      new CustomEvent<string>("bm-archive", {
        detail: this.system.id,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-system-sheet": BoatSystemSheet;
  }
}
