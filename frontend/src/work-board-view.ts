import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import { BOARD_COLUMNS } from "./work";
import type { WorkItemRecord } from "./types";

// Presentational Kanban board of active work items, grouped into columns by
// status (lifecycle order). State lives in the shell; this view renders what it
// is given and emits `bm-edit` when a card is tapped. Crew names are resolved by
// the shell and passed in as a lookup keyed by stable id (ids stay canonical).
//
// No drag-and-drop: transitions are validated server-side and a tap-to-act sheet
// keeps the interaction reliable and testable. Cancelled work is omitted (it is
// terminal and not actionable); done work stays visible so it can be reopened.
@customElement("boat-work-board-view")
export class BoatWorkBoardView extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      .board {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding: 12px 12px calc(var(--bm-nav-h) + 88px);
        scroll-snap-type: x proximity;
      }
      .col {
        flex: 0 0 78%;
        max-width: 320px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        scroll-snap-align: start;
      }
      .col-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 4px;
        position: sticky;
        top: 0;
      }
      .col-title {
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--bm-text-dim);
      }
      .col-count {
        font-size: 12px;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--bm-surface-2);
        color: var(--bm-text-dim);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .col-empty {
        color: var(--bm-text-dim);
        font-size: 13px;
        padding: 10px 4px;
        opacity: 0.6;
      }
      .card {
        background: var(--bm-surface);
        border: 1px solid var(--bm-divider);
        border-radius: var(--bm-radius);
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .card:active {
        background: var(--bm-surface-2);
      }
      .card-title {
        font-size: 15px;
        font-weight: 600;
      }
      .card-meta {
        font-size: 13px;
      }
      .card-block {
        font-size: 12px;
        margin-top: 2px;
        color: var(--bm-danger);
      }
    `,
  ];

  @property({ attribute: false }) items: WorkItemRecord[] = [];
  @property({ attribute: false }) crewNames: Record<string, string> = {};

  override render() {
    const grouped = this._grouped();
    const total = BOARD_COLUMNS.reduce(
      (n, col) => n + grouped[col.status].length,
      0,
    );
    if (total === 0) {
      return html`<div class="empty">
        No active work.<br />Tap + to instantiate a task from the catalogue.
      </div>`;
    }
    return html`<div class="board">
      ${BOARD_COLUMNS.map((col) =>
        this._column(col.status, col.label, grouped[col.status]),
      )}
    </div>`;
  }

  // Group items into the board's columns. Items whose status is not a column
  // (e.g. cancelled) are dropped — they have no actionable place on the board.
  private _grouped(): Record<string, WorkItemRecord[]> {
    const out: Record<string, WorkItemRecord[]> = {};
    for (const col of BOARD_COLUMNS) out[col.status] = [];
    for (const item of this.items) {
      if (out[item.status]) out[item.status].push(item);
    }
    return out;
  }

  private _column(status: string, label: string, items: WorkItemRecord[]) {
    return html`<section class="col" data-status=${status}>
      <div class="col-head">
        <span class="col-title">${label}</span>
        <span class="col-count">${items.length}</span>
      </div>
      ${items.length === 0
        ? html`<div class="col-empty">—</div>`
        : items.map((item) => this._card(item))}
    </section>`;
  }

  private _card(item: WorkItemRecord) {
    const assignee = item.assigned_to
      ? (this.crewNames[item.assigned_to] ?? null)
      : null;
    const meta = [assignee, item.due_date].filter(Boolean).join(" · ");
    return html`<article
      class="card"
      role="button"
      tabindex="0"
      @click=${() => this._select(item)}
    >
      <div class="card-title ellipsis">${item.title ?? "Untitled"}</div>
      ${meta ? html`<div class="card-meta muted ellipsis">${meta}</div>` : nothing}
      ${item.block_reason
        ? html`<div class="card-block ellipsis">${item.block_reason}</div>`
        : nothing}
    </article>`;
  }

  private _select(item: WorkItemRecord): void {
    this.dispatchEvent(
      new CustomEvent("bm-edit", { detail: item, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-work-board-view": BoatWorkBoardView;
  }
}
