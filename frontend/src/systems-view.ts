import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { SystemRecord } from "./types";

// Presentational list of systems. State lives in the shell; this view renders
// what it is given and emits `bm-edit` when a row is tapped.
@customElement("boat-systems-view")
export class BoatSystemsView extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      ul {
        list-style: none;
        margin: 0;
        padding: 8px 12px calc(var(--bm-nav-h) + 88px);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      li {
        background: var(--bm-surface);
        border: 1px solid var(--bm-divider);
        border-radius: var(--bm-radius);
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      li:active {
        background: var(--bm-surface-2);
      }
      .name {
        font-size: 16px;
        font-weight: 600;
      }
      .sub {
        font-size: 13px;
        margin-top: 2px;
      }
      .chev {
        color: var(--bm-text-dim);
        flex: 0 0 auto;
      }
    `,
  ];

  @property({ attribute: false }) systems: SystemRecord[] = [];

  override render() {
    if (this.systems.length === 0) {
      return html`<div class="empty">
        No systems yet.<br />Tap + to add your first one.
      </div>`;
    }
    return html`<ul>
      ${this.systems.map(
        (system) => html`<li
          @click=${() => this._select(system)}
          role="button"
          tabindex="0"
        >
          <div class="grow">
            <div class="name ellipsis">${system.name}</div>
            ${system.category || system.description
              ? html`<div class="sub muted ellipsis">
                  ${system.category
                    ? html`<span class="chip">${system.category}</span> `
                    : nothing}${system.description ?? ""}
                </div>`
              : nothing}
          </div>
          <span class="chev">›</span>
        </li>`,
      )}
    </ul>`;
  }

  private _select(system: SystemRecord): void {
    this.dispatchEvent(
      new CustomEvent("bm-edit", { detail: system, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-systems-view": BoatSystemsView;
  }
}
