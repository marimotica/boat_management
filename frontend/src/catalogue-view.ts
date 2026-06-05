import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { CatalogueLastCompleted, CatalogueTaskRecord } from "./types";

// Presentational list of catalogue task definitions. State lives in the shell;
// this view renders what it is given and emits `bm-edit` when a row is tapped.
// System names and the "last completed" summary are resolved by the shell and
// passed in as lookups keyed by stable id (ids stay canonical).
@customElement("boat-catalogue-view")
export class BoatCatalogueView extends LitElement {
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
      .skills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
      }
      .done {
        font-size: 12px;
        color: var(--bm-text-dim);
        margin-top: 6px;
      }
      .chev {
        color: var(--bm-text-dim);
        flex: 0 0 auto;
      }
    `,
  ];

  @property({ attribute: false }) tasks: CatalogueTaskRecord[] = [];
  @property({ attribute: false }) systemNames: Record<string, string> = {};
  @property({ attribute: false }) lastCompleted: Record<
    string,
    CatalogueLastCompleted
  > = {};

  override render() {
    if (this.tasks.length === 0) {
      return html`<div class="empty">
        No catalogue tasks yet.<br />Tap + to define your first reusable task.
      </div>`;
    }
    return html`<ul>
      ${this.tasks.map((task) => this._row(task))}
    </ul>`;
  }

  private _row(task: CatalogueTaskRecord) {
    const systems = task.system_refs
      .map((id) => this.systemNames[id])
      .filter(Boolean);
    const duration =
      task.estimated_duration_minutes != null
        ? `${task.estimated_duration_minutes} min`
        : "";
    const sub = [systems.join(", "), duration].filter(Boolean).join(" · ");
    const done = this.lastCompleted[task.id];
    return html`<li @click=${() => this._select(task)} role="button" tabindex="0">
      <div class="grow">
        <div class="name ellipsis">${task.title}</div>
        ${sub ? html`<div class="sub muted ellipsis">${sub}</div>` : nothing}
        ${task.required_skills.length
          ? html`<div class="skills">
              ${task.required_skills.map(
                (skill) => html`<span class="chip">${skill}</span>`,
              )}
            </div>`
          : nothing}
        <div class="done">
          ${done
            ? html`Last done ${done.date}${done.verifierName
                ? html` · ${done.verifierName}`
                : nothing}`
            : "Never completed"}
        </div>
      </div>
      <span class="chev">›</span>
    </li>`;
  }

  private _select(task: CatalogueTaskRecord): void {
    this.dispatchEvent(
      new CustomEvent("bm-edit", { detail: task, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-catalogue-view": BoatCatalogueView;
  }
}
