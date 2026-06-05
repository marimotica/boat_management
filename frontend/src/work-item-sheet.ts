import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import { statusLabel, WORK_STATUS } from "./work";
import type { MultiselectOption } from "./multiselect";
import type { WorkItemRecord } from "./types";

// A controlled write intent emitted by the sheet. The shell maps each kind onto
// the matching websocket command using the current work item id, so adding a
// lifecycle action is a single union member + a single shell case (no event
// sprawl). `create` carries no id — the backend assigns it.
export type WorkAction =
  | {
      kind: "create";
      catalogue_task_id: string;
      title?: string;
      assigned_to?: string;
      due_date?: string;
    }
  | { kind: "claim"; id: string; crew_id: string }
  | { kind: "start"; id: string }
  | { kind: "submit"; id: string; completion_notes?: string }
  | { kind: "block"; id: string; block_reason?: string }
  | { kind: "defer"; id: string; reason?: string }
  | { kind: "cancel"; id: string; reason?: string }
  | { kind: "unblock"; id: string; target: string }
  | { kind: "reopen"; id: string; reason?: string }
  | { kind: "verify"; id: string; verified_by: string; notes?: string };

// Bottom-sheet for instantiating and acting on a work item. Two modes:
//   create (item == null): pick a catalogue task and optionally seed assignee /
//     due date — operational events instantiate KNOWN tasks, never arbitrary
//     work, so the catalogue task is required.
//   act    (item set):     show a summary and the lifecycle actions valid for
//     the current status, emitting a `bm-action` intent. The backend transition
//     matrix remains the source of truth; this view only offers the legal moves.
//
// Purely presentational: it seeds from inputs, collects local edits, and emits
// intent (`bm-action`, `bm-close`). All persistence and id assignment happen in
// the shell.
@customElement("boat-work-item-sheet")
export class BoatWorkItemSheet extends LitElement {
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
        max-height: 92%;
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
        margin: 0 0 6px;
        font-size: 18px;
      }
      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 4px 0 14px;
      }
      .block {
        margin: 0 0 14px;
        padding: 10px 12px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--bm-danger) 14%, transparent);
        border: 1px solid var(--bm-danger);
        font-size: 13px;
      }
      .notes {
        margin: 0 0 14px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--bm-surface-2);
        border: 1px solid var(--bm-divider);
        font-size: 13px;
        white-space: pre-wrap;
      }
      .notes .label,
      .group .label {
        color: var(--bm-text-dim);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        margin-bottom: 4px;
      }
      textarea {
        min-height: 64px;
        resize: vertical;
      }
      .group {
        border-top: 1px solid var(--bm-divider);
        margin-top: 8px;
        padding-top: 14px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }
      .actions .grow {
        flex: 1;
      }
      .actions .btn {
        flex: 1 0 auto;
      }
      .btn.full {
        width: 100%;
      }
    `,
  ];

  // null/undefined => create mode; a record => act mode.
  @property({ attribute: false }) item: WorkItemRecord | null = null;
  // Catalogue task picker options for create mode (id + title).
  @property({ attribute: false }) taskOptions: MultiselectOption[] = [];
  // Active crew for assignment/claim (plain names).
  @property({ attribute: false }) crew: MultiselectOption[] = [];
  // Active crew for verification, labelled with role (backend enforces the role).
  @property({ attribute: false }) verifiers: MultiselectOption[] = [];
  // The catalogue task's default verifier id, used to pre-select on review.
  @property() defaultVerifier: string | null = null;
  @property({ type: Boolean }) saving = false;
  @property() error: string | null = null;

  @state() private _taskId = "";
  @state() private _title = "";
  @state() private _assignee = "";
  @state() private _due = "";
  @state() private _verifier = "";
  @state() private _reason = "";
  @state() private _notes = "";

  // Reseed only when the target identity changes, so an action-driven refresh of
  // the same item (which keeps the sheet open) does not clobber in-flight edits
  // (mirrors the inventory sheet's seed-guard). The shell sets `item` and
  // `defaultVerifier` together when opening, so seeding off `item` is enough.
  private _seeded = false;
  private _seededId: string | null = null;

  override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has("item")) return;
    const id = this.item?.id ?? null;
    if (this._seeded && id === this._seededId) return;
    this._seed();
    this._seeded = true;
    this._seededId = id;
  }

  private _seed(): void {
    const item = this.item;
    this._taskId = "";
    this._title = "";
    this._assignee = item?.assigned_to ?? "";
    this._due = item?.due_date ?? "";
    this._reason = "";
    this._notes = "";
    // Pre-select the catalogue task's default verifier on review; the backend
    // still enforces the verifier's role at verify time.
    this._verifier = item?.verified_by ?? this.defaultVerifier ?? "";
  }

  override render() {
    const creating = !this.item;
    return html`<div class="scrim" @click=${this._onScrim}>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="grabber"></div>
        ${this.error ? html`<div class="banner">${this.error}</div>` : nothing}
        ${creating ? this._renderCreate() : this._renderAct()}
      </div>
    </div>`;
  }

  // --- Create mode ---------------------------------------------------------
  private _renderCreate() {
    const canCreate = this._taskId.trim().length > 0 && !this.saving;
    return html`
      <h2>New work item</h2>
      <div class="field">
        <label for="task">Catalogue task</label>
        <select
          id="task"
          .value=${this._taskId}
          ?disabled=${this.saving}
          @change=${(e: Event) =>
            (this._taskId = (e.target as HTMLSelectElement).value)}
        >
          <option value="">Select a task…</option>
          ${this.taskOptions.map(
            (task) => html`<option
              value=${task.id}
              ?selected=${task.id === this._taskId}
            >
              ${task.name}
            </option>`,
          )}
        </select>
      </div>

      <div class="field">
        <label for="title">Title override</label>
        <input
          id="title"
          .value=${this._title}
          placeholder="Defaults to the task title"
          ?disabled=${this.saving}
          @input=${(e: InputEvent) =>
            (this._title = (e.target as HTMLInputElement).value)}
        />
      </div>

      ${this._assigneeField()}

      <div class="field">
        <label for="due">Due date</label>
        <input
          id="due"
          type="date"
          .value=${this._due}
          ?disabled=${this.saving}
          @input=${(e: InputEvent) =>
            (this._due = (e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="actions">
        <span class="grow"></span>
        <button class="btn" ?disabled=${this.saving} @click=${this._close}>
          Cancel
        </button>
        <button
          class="btn primary"
          data-action="create"
          ?disabled=${!canCreate}
          @click=${this._create}
        >
          ${this.saving ? "Saving…" : "Create"}
        </button>
      </div>
    `;
  }

  // --- Act mode ------------------------------------------------------------
  private _renderAct() {
    const item = this.item!;
    return html`
      <h2 class="ellipsis">${item.title ?? "Work item"}</h2>
      <div class="summary">
        <span class="chip">${statusLabel(item.status)}</span>
        ${item.assigned_to
          ? html`<span class="chip">${this._crewName(item.assigned_to)}</span>`
          : nothing}
        ${item.due_date ? html`<span class="chip">due ${item.due_date}</span>` : nothing}
        ${item.trigger_source && item.trigger_source !== "manual"
          ? html`<span class="chip">${item.trigger_source}</span>`
          : nothing}
      </div>
      ${item.block_reason
        ? html`<div class="block">${item.block_reason}</div>`
        : nothing}
      ${item.completion_notes
        ? html`<div class="notes">
            <div class="label">Completion notes</div>
            ${item.completion_notes}
          </div>`
        : nothing}
      ${this._renderActions(item)}
      <div class="actions">
        <span class="grow"></span>
        <button class="btn" ?disabled=${this.saving} @click=${this._close}>
          Close
        </button>
      </div>
    `;
  }

  private _renderActions(item: WorkItemRecord) {
    switch (item.status) {
      case WORK_STATUS.TODO:
        return html`
          ${this._claimGroup("Assign")}
          ${this._reasonGroup()}
          <div class="actions">
            ${this._actBtn("block", "Block")}
            ${this._actBtn("defer", "Defer")}
            ${this._actBtn("cancel", "Cancel", true)}
            <button
              class="btn primary"
              data-action="start"
              ?disabled=${this.saving}
              @click=${() => this._emit({ kind: "start", id: item.id })}
            >
              Start work
            </button>
          </div>
        `;
      case WORK_STATUS.IN_PROGRESS:
        return html`
          <div class="field">
            <label for="notes">Completion notes</label>
            <textarea
              id="notes"
              .value=${this._notes}
              placeholder="What was done (optional)"
              ?disabled=${this.saving}
              @input=${(e: InputEvent) =>
                (this._notes = (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </div>
          ${this._claimGroup("Reassign")}
          ${this._reasonGroup()}
          <div class="actions">
            ${this._actBtn("block", "Block")}
            ${this._actBtn("defer", "Defer")}
            ${this._actBtn("cancel", "Cancel", true)}
            <button
              class="btn primary"
              data-action="submit"
              ?disabled=${this.saving}
              @click=${() =>
                this._emit({
                  kind: "submit",
                  id: item.id,
                  completion_notes: this._notes.trim() || undefined,
                })}
            >
              Submit for review
            </button>
          </div>
        `;
      case WORK_STATUS.REVIEW:
        return this._renderReview(item);
      case WORK_STATUS.BLOCKED:
      case WORK_STATUS.DEFERRED:
        return html`<div class="actions">
          <button
            class="btn"
            data-action="resume"
            ?disabled=${this.saving}
            @click=${() =>
              this._emit({
                kind: "unblock",
                id: item.id,
                target: WORK_STATUS.IN_PROGRESS,
              })}
          >
            Resume work
          </button>
          <button
            class="btn primary"
            data-action="unblock"
            ?disabled=${this.saving}
            @click=${() =>
              this._emit({
                kind: "unblock",
                id: item.id,
                target: WORK_STATUS.TODO,
              })}
          >
            Move to To Do
          </button>
        </div>`;
      case WORK_STATUS.DONE:
        return html`
          ${this._reasonGroup("Reason")}
          <div class="actions">
            <button
              class="btn primary full"
              data-action="reopen"
              ?disabled=${this.saving}
              @click=${() =>
                this._emit({
                  kind: "reopen",
                  id: item.id,
                  reason: this._reason.trim() || undefined,
                })}
            >
              Reopen as corrective item
            </button>
          </div>
        `;
      default:
        // Cancelled or unknown: terminal, nothing to act on.
        return nothing;
    }
  }

  private _renderReview(item: WorkItemRecord) {
    const canVerify = this._verifier.trim().length > 0 && !this.saving;
    return html`
      <div class="field">
        <label for="verifier">Verified by</label>
        <select
          id="verifier"
          .value=${this._verifier}
          ?disabled=${this.saving}
          @change=${(e: Event) =>
            (this._verifier = (e.target as HTMLSelectElement).value)}
        >
          <option value="">Select a verifier…</option>
          ${this.verifiers.map(
            (crew) => html`<option
              value=${crew.id}
              ?selected=${crew.id === this._verifier}
            >
              ${crew.name}
            </option>`,
          )}
        </select>
      </div>
      <div class="field">
        <label for="vnotes">Verification notes</label>
        <textarea
          id="vnotes"
          .value=${this._notes}
          placeholder="optional"
          ?disabled=${this.saving}
          @input=${(e: InputEvent) =>
            (this._notes = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>
      ${this._reasonGroup()}
      <div class="actions">
        <button
          class="btn"
          data-action="send-back"
          ?disabled=${this.saving}
          @click=${() => this._emit({ kind: "start", id: item.id })}
        >
          Send back
        </button>
        ${this._actBtn("defer", "Defer")}
        ${this._actBtn("cancel", "Cancel", true)}
        <button
          class="btn primary"
          data-action="verify"
          ?disabled=${!canVerify}
          @click=${() =>
            this._emit({
              kind: "verify",
              id: item.id,
              verified_by: this._verifier,
              notes: this._notes.trim() || undefined,
            })}
        >
          Verify &amp; log
        </button>
      </div>
    `;
  }

  // Shared assignee picker + claim button (todo/in_progress). Disabled unless a
  // crew member is chosen; reassigning to the same person is a no-op so it is
  // disabled too.
  private _claimGroup(label: string) {
    const item = this.item!;
    const canClaim =
      this._assignee.trim().length > 0 &&
      this._assignee !== (item.assigned_to ?? "") &&
      !this.saving;
    return html`<div class="group">
      ${this._assigneeField()}
      <button
        class="btn"
        data-action="claim"
        ?disabled=${!canClaim}
        @click=${() =>
          this._emit({ kind: "claim", id: item.id, crew_id: this._assignee })}
      >
        ${label}
      </button>
    </div>`;
  }

  private _assigneeField() {
    return html`<div class="field">
      <label for="assignee">Assignee</label>
      <select
        id="assignee"
        .value=${this._assignee}
        ?disabled=${this.saving}
        @change=${(e: Event) =>
          (this._assignee = (e.target as HTMLSelectElement).value)}
      >
        <option value="">Unassigned</option>
        ${this.crew.map(
          (c) => html`<option value=${c.id} ?selected=${c.id === this._assignee}>
            ${c.name}
          </option>`,
        )}
      </select>
    </div>`;
  }

  // Shared optional reason, read by block/defer/cancel (and reopen).
  private _reasonGroup(label = "Reason") {
    return html`<div class="field">
      <label for="reason">${label}</label>
      <input
        id="reason"
        .value=${this._reason}
        placeholder="optional"
        ?disabled=${this.saving}
        @input=${(e: InputEvent) =>
          (this._reason = (e.target as HTMLInputElement).value)}
      />
    </div>`;
  }

  // block/defer/cancel share the reason field; emit the matching intent.
  private _actBtn(
    kind: "block" | "defer" | "cancel",
    label: string,
    danger = false,
  ) {
    const item = this.item!;
    return html`<button
      class=${danger ? "btn danger" : "btn"}
      data-action=${kind}
      ?disabled=${this.saving}
      @click=${() => this._emitReasoned(kind, item.id)}
    >
      ${label}
    </button>`;
  }

  private _emitReasoned(
    kind: "block" | "defer" | "cancel",
    id: string,
  ): void {
    const reason = this._reason.trim() || undefined;
    if (kind === "block") {
      this._emit({ kind, id, block_reason: reason });
    } else {
      this._emit({ kind, id, reason });
    }
  }

  private _crewName(id: string): string {
    return (
      this.crew.find((c) => c.id === id)?.name ??
      this.verifiers.find((c) => c.id === id)?.name ??
      id
    );
  }

  private _onScrim(): void {
    if (!this.saving) this._close();
  }

  private _close(): void {
    this.dispatchEvent(
      new CustomEvent("bm-close", { bubbles: true, composed: true }),
    );
  }

  private _create(): void {
    if (!this._taskId) return;
    this._emit({
      kind: "create",
      catalogue_task_id: this._taskId,
      title: this._title.trim() || undefined,
      assigned_to: this._assignee || undefined,
      due_date: this._due || undefined,
    });
  }

  private _emit(action: WorkAction): void {
    this.dispatchEvent(
      new CustomEvent<WorkAction>("bm-action", {
        detail: action,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-work-item-sheet": BoatWorkItemSheet;
  }
}
