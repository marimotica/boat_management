import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { EquipmentRecord } from "./types";

// Presentational list of equipment. State lives in the shell; this view renders
// what it is given and emits `bm-edit` when a row is tapped. The system name is
// resolved by the shell and passed in as a lookup map (ids stay canonical).
@customElement("boat-equipment-view")
export class BoatEquipmentView extends LitElement {
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
      .docs {
        font-size: 12px;
        color: var(--bm-text-dim);
        margin-top: 4px;
      }
    `,
  ];

  @property({ attribute: false }) equipment: EquipmentRecord[] = [];
  @property({ attribute: false }) systemNames: Record<string, string> = {};

  override render() {
    if (this.equipment.length === 0) {
      return html`<div class="empty">
        No equipment yet.<br />Tap + to add your first item.
      </div>`;
    }
    return html`<ul>
      ${this.equipment.map((item) => this._row(item))}
    </ul>`;
  }

  private _row(item: EquipmentRecord) {
    const makeModel = [item.manufacturer, item.model]
      .filter(Boolean)
      .join(" ");
    const systemName = item.system_id
      ? this.systemNames[item.system_id]
      : undefined;
    const docCount = item.documentation_refs.length;
    return html`<li @click=${() => this._select(item)} role="button" tabindex="0">
      <div class="grow">
        <div class="name ellipsis">${item.name}</div>
        ${systemName || makeModel || item.location
          ? html`<div class="sub muted ellipsis">
              ${systemName
                ? html`<span class="chip">${systemName}</span> `
                : nothing}${[makeModel, item.location]
                .filter(Boolean)
                .join(" · ")}
            </div>`
          : nothing}
        ${docCount
          ? html`<div class="docs">
              ${docCount} ${docCount === 1 ? "document" : "documents"}
            </div>`
          : nothing}
      </div>
      <span class="chev">›</span>
    </li>`;
  }

  private _select(item: EquipmentRecord): void {
    this.dispatchEvent(
      new CustomEvent("bm-edit", { detail: item, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-equipment-view": BoatEquipmentView;
  }
}
