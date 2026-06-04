import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { InventoryRecord } from "./types";

// Mirror of InventoryItem.is_low_stock() for badge/filter display. The backend
// remains authoritative for any write decision; this is presentation only.
// Quantities are serialized as strings to preserve Decimal precision; Number()
// is acceptable for a visual threshold comparison.
export function isLowStock(item: InventoryRecord): boolean {
  const threshold = item.reorder_level ?? item.minimum_stock;
  if (threshold == null) return false;
  return Number(item.quantity) <= Number(threshold);
}

// Presentational list of inventory items. State lives in the shell; this view
// renders what it is given and emits `bm-edit` when a row is tapped.
@customElement("boat-inventory-view")
export class BoatInventoryView extends LitElement {
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
      .qty {
        flex: 0 0 auto;
        text-align: right;
      }
      .qty .num {
        font-size: 16px;
        font-weight: 700;
      }
      .qty .unit {
        font-size: 12px;
        color: var(--bm-text-dim);
      }
      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }
      .badge {
        display: inline-flex;
        padding: 1px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.3px;
      }
      .badge.warn {
        background: color-mix(in srgb, #e9a23b 22%, transparent);
        color: #e9a23b;
      }
      .badge.danger {
        background: color-mix(in srgb, var(--bm-danger) 22%, transparent);
        color: var(--bm-danger);
      }
    `,
  ];

  @property({ attribute: false }) inventory: InventoryRecord[] = [];

  override render() {
    if (this.inventory.length === 0) {
      return html`<div class="empty">
        No inventory yet.<br />Tap + to add a spare or consumable.
      </div>`;
    }
    return html`<ul>
      ${this.inventory.map((item) => this._row(item))}
    </ul>`;
  }

  private _row(item: InventoryRecord) {
    const low = isLowStock(item);
    return html`<li @click=${() => this._select(item)} role="button" tabindex="0">
      <div class="grow">
        <div class="name ellipsis">${item.name}</div>
        ${item.storage_location || item.part_number
          ? html`<div class="sub muted ellipsis">
              ${[item.part_number, item.storage_location]
                .filter(Boolean)
                .join(" · ")}
            </div>`
          : nothing}
        ${low || item.expired
          ? html`<div class="badges">
              ${low ? html`<span class="badge warn">LOW</span>` : nothing}
              ${item.expired
                ? html`<span class="badge danger">EXPIRED</span>`
                : nothing}
            </div>`
          : nothing}
      </div>
      <div class="qty">
        <div class="num">${item.quantity}</div>
        <div class="unit">${item.unit}</div>
      </div>
    </li>`;
  }

  private _select(item: InventoryRecord): void {
    this.dispatchEvent(
      new CustomEvent("bm-edit", { detail: item, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-inventory-view": BoatInventoryView;
  }
}
