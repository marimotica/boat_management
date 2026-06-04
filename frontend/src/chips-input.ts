import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";

// Free-form list-of-strings editor used for documentation references (URLs,
// manual ids, file paths). The parent owns the canonical array; this control is
// presentational and emits `bm-change` with the next array on every mutation.
// References are opaque strings by design (AGENTS.md: photos/docs are refs, not
// blobs), so no format is enforced beyond trimming and de-duplication.
@customElement("boat-chips-input")
export class BoatChipsInput extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 4px 6px 4px 12px;
        border-radius: 999px;
        background: var(--bm-surface-2);
        font-size: 13px;
      }
      .tag span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tag button {
        border: none;
        background: none;
        color: var(--bm-text-dim);
        font-size: 16px;
        line-height: 1;
        padding: 0 2px;
      }
    `,
  ];

  @property({ attribute: false }) values: string[] = [];
  @property() label = "";
  @property() placeholder = "Add a reference, then Enter";
  @property({ type: Boolean }) disabled = false;

  @state() private _draft = "";

  override render() {
    return html`<div class="field">
      ${this.label ? html`<label>${this.label}</label>` : nothing}
      ${this.values.length
        ? html`<div class="chips">
            ${this.values.map(
              (value, index) => html`<span class="tag">
                <span>${value}</span>
                <button
                  type="button"
                  title="Remove"
                  ?disabled=${this.disabled}
                  @click=${() => this._remove(index)}
                >
                  ×
                </button>
              </span>`,
            )}
          </div>`
        : nothing}
      <input
        .value=${this._draft}
        placeholder=${this.placeholder}
        ?disabled=${this.disabled}
        @input=${(e: InputEvent) =>
          (this._draft = (e.target as HTMLInputElement).value)}
        @keydown=${this._onKeydown}
        @blur=${this._commit}
      />
    </div>`;
  }

  private _onKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      this._commit();
    }
  }

  private _commit(): void {
    const value = this._draft.trim();
    this._draft = "";
    if (!value || this.values.includes(value)) return;
    this._emit([...this.values, value]);
  }

  private _remove(index: number): void {
    this._emit(this.values.filter((_, i) => i !== index));
  }

  private _emit(next: string[]): void {
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
    "boat-chips-input": BoatChipsInput;
  }
}
