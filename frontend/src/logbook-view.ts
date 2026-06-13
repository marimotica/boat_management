import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { MaintenanceLogRecord } from "./types";

// Presentational, read-only view of the immutable maintenance logbook. State
// lives in the shell; this view renders what it is given (already ordered most
// recent first). Entries are history and never editable here — amendments are a
// separate, audited flow — so rows are intentionally not interactive.
//
// Task titles and crew names are resolved by the shell and passed in as lookups
// keyed by stable id (ids stay canonical). The completion date shown is the
// stored local string captured at completion time and is rendered verbatim —
// never re-derived from UTC — so history stays stable across vessel timezone
// changes.
@customElement("boat-logbook-view")
export class BoatLogbookView extends LitElement {
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
      }
      .name {
        font-size: 16px;
        font-weight: 600;
      }
      .when {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }
      .date {
        font-size: 13px;
      }
      .meta {
        font-size: 13px;
        margin-top: 4px;
      }
      .notes {
        font-size: 13px;
        margin-top: 8px;
        white-space: pre-wrap;
      }
    `,
  ];

  @property({ attribute: false }) entries: MaintenanceLogRecord[] = [];
  @property({ attribute: false }) taskTitles: Record<string, string> = {};
  @property({ attribute: false }) crewNames: Record<string, string> = {};

  override render() {
    if (this.entries.length === 0) {
      return html`<div class="empty">
        No maintenance logged yet.<br />Verified work is recorded here.
      </div>`;
    }
    return html`<ul>
      ${this.entries.map((entry) => this._row(entry))}
    </ul>`;
  }

  private _row(entry: MaintenanceLogRecord) {
    const title = this.taskTitles[entry.catalogue_task_id] ?? "Maintenance";
    const verifier = this.crewNames[entry.verified_by] ?? entry.verified_by;
    const completedBy = entry.completed_by
      ? (this.crewNames[entry.completed_by] ?? entry.completed_by)
      : null;
    // Only name the doer separately when they differ from the verifier — most
    // small-crew jobs are done and verified by the same person.
    const meta =
      completedBy && completedBy !== verifier
        ? `Done by ${completedBy} · verified by ${verifier}`
        : `Verified by ${verifier}`;
    return html`<li>
      <div class="name ellipsis">${title}</div>
      <div class="when">
        <span class="date">${entry.completed_at_local}</span>
        <span class="chip">${entry.timezone_at_completion}</span>
      </div>
      <div class="meta muted">${meta}</div>
      ${entry.notes ? html`<div class="notes">${entry.notes}</div>` : nothing}
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-logbook-view": BoatLogbookView;
  }
}
