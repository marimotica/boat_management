import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";

export interface MultiselectOption {
  id: string;
  name: string;
}

// Toggleable chip group for picking a stable set of object ids (e.g. linking
// inventory to equipment). The parent owns the canonical selection; this
// control renders options it is given and emits `bm-change` with the next id
// array. Ids are always opaque server-assigned values — never display names.
@customElement("boat-multiselect")
export class BoatMultiselect extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      .options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .opt {
        padding: 7px 14px;
        border-radius: 999px;
        border: 1px solid var(--bm-divider);
        background: var(--bm-surface-2);
        color: var(--bm-text);
        font-size: 13px;
        font-weight: 600;
      }
      .opt[aria-pressed="true"] {
        background: var(--bm-accent);
        color: var(--bm-on-accent);
        border-color: var(--bm-accent);
      }
      .opt:disabled {
        opacity: 0.5;
      }
    `,
  ];

  @property({ attribute: false }) options: MultiselectOption[] = [];
  @property({ attribute: false }) selected: string[] = [];
  @property() label = "";
  @property({ type: Boolean }) disabled = false;

  override render() {
    return html`<div class="field">
      ${this.label ? html`<label>${this.label}</label>` : nothing}
      ${this.options.length
        ? html`<div class="options">
            ${this.options.map((option) => {
              const on = this.selected.includes(option.id);
              return html`<button
                type="button"
                class="opt"
                aria-pressed=${on}
                ?disabled=${this.disabled}
                @click=${() => this._toggle(option.id)}
              >
                ${option.name}
              </button>`;
            })}
          </div>`
        : html`<span class="muted">Nothing to link yet.</span>`}
    </div>`;
  }

  private _toggle(id: string): void {
    const next = this.selected.includes(id)
      ? this.selected.filter((value) => value !== id)
      : [...this.selected, id];
    this.dispatchEvent(
      new CustomEvent<string[]>("bm-change", {
        detail: next,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-multiselect": BoatMultiselect;
  }
}
