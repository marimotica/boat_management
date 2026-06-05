import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { SuggestionRecord } from "./types";

// Human labels for trigger sources surfaced on suggestion cards. An unknown
// source falls back to its raw token, so a future backend source still renders
// legibly instead of disappearing.
const SOURCE_LABELS: Record<string, string> = {
  inventory: "Low stock",
  calendar: "Scheduled",
  engine_hours: "Engine hours",
  seasonal_transition: "Seasonal",
  passage_plan: "Passage",
  inspection_result: "Inspection",
  equipment_fault: "Fault",
  meter_threshold: "Meter",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// Presentational list of state-driven maintenance suggestions. State lives in
// the shell; this view renders what it is given and emits `bm-apply` with the
// tapped suggestion (it never instantiates work itself). A suggestion already
// represented by open work is shown but not actionable — an "On board" chip
// replaces the Apply button — so the skipper sees the full operational picture
// without being able to create duplicate work (the backend dedups regardless).
@customElement("boat-suggestions-view")
export class BoatSuggestionsView extends LitElement {
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
      .name {
        font-size: 16px;
        font-weight: 600;
      }
      .reason {
        font-size: 13px;
        margin-top: 2px;
      }
      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      button.apply {
        flex: 0 0 auto;
        padding: 10px 18px;
      }
      .onboard {
        flex: 0 0 auto;
        white-space: nowrap;
      }
    `,
  ];

  @property({ attribute: false }) suggestions: SuggestionRecord[] = [];

  override render() {
    if (this.suggestions.length === 0) {
      return html`<div class="empty">
        Nothing suggested.<br />Stock is healthy and no scheduled work is due.
      </div>`;
    }
    return html`<ul>
      ${this.suggestions.map((s) => this._row(s))}
    </ul>`;
  }

  private _row(s: SuggestionRecord) {
    return html`<li>
      <div class="grow">
        <div class="name ellipsis">${s.title}</div>
        <div class="reason muted">${s.reason}</div>
        <div class="badges">
          <span class="chip">${sourceLabel(s.source)}</span>
          ${s.context_label
            ? html`<span class="chip">${s.context_label}</span>`
            : nothing}
        </div>
      </div>
      ${s.already_open
        ? html`<span class="chip onboard">On board</span>`
        : html`<button
            class="btn primary apply"
            @click=${() => this._apply(s)}
          >
            Apply
          </button>`}
    </li>`;
  }

  private _apply(s: SuggestionRecord): void {
    this.dispatchEvent(
      new CustomEvent("bm-apply", { detail: s, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-suggestions-view": BoatSuggestionsView;
  }
}
