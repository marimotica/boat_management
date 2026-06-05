import { describe, it, expect, afterEach } from "vitest";
import {
  BoatWorkItemSheet,
  type WorkAction,
} from "../src/work-item-sheet";
import type { MultiselectOption } from "../src/multiselect";
import { mount, nextEvent, update, workItemRecord } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

const TASKS: MultiselectOption[] = [
  { id: "task-1", name: "Service raw-water pump" },
  { id: "task-2", name: "Inspect windlass" },
];
const CREW: MultiselectOption[] = [
  { id: "crew-1", name: "Sam" },
  { id: "crew-2", name: "Alex" },
];
const VERIFIERS: MultiselectOption[] = [
  { id: "crew-1", name: "Sam (skipper)" },
  { id: "crew-2", name: "Alex (crew)" },
];

function q<T extends HTMLElement>(el: HTMLElement, sel: string): T {
  return el.shadowRoot!.querySelector(sel)!;
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new InputEvent("input"));
}

function setSelect(sel: HTMLSelectElement, value: string) {
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
}

describe("<boat-work-item-sheet> create mode", () => {
  it("titles itself for a new item and lists catalogue tasks plus a prompt", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: null,
      taskOptions: TASKS,
      crew: CREW,
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(
      "New work item",
    );
    const options = el.shadowRoot!.querySelectorAll("#task option");
    expect(options).toHaveLength(3);
    expect(options[0].textContent!.trim()).toBe("Select a task…");
    expect(options[1].textContent!.trim()).toBe("Service raw-water pump");
  });

  it("disables Create until a catalogue task is chosen", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: null,
      taskOptions: TASKS,
    });
    const create = q<HTMLButtonElement>(el, '[data-action="create"]');
    expect(create.disabled).toBe(true);
    setSelect(q<HTMLSelectElement>(el, "#task"), "task-1");
    await update(el);
    expect(create.disabled).toBe(false);
  });

  it("emits a create action with the task id and no work-item id", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: null,
      taskOptions: TASKS,
      crew: CREW,
    });
    setSelect(q<HTMLSelectElement>(el, "#task"), "task-2");
    setValue(q<HTMLInputElement>(el, "#title"), "Inspect bow windlass");
    setSelect(q<HTMLSelectElement>(el, "#assignee"), "crew-1");
    setValue(q<HTMLInputElement>(el, "#due"), "2024-06-01");
    await update(el);

    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="create"]').click();
    const detail = (await event).detail;
    expect(detail).toEqual({
      kind: "create",
      catalogue_task_id: "task-2",
      title: "Inspect bow windlass",
      assigned_to: "crew-1",
      due_date: "2024-06-01",
    });
    // The panel never invents the id; the server assigns it.
    expect(detail).not.toHaveProperty("id");
  });

  it("omits blank optional fields from the create action", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: null,
      taskOptions: TASKS,
    });
    setSelect(q<HTMLSelectElement>(el, "#task"), "task-1");
    await update(el);
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="create"]').click();
    const detail = (await event).detail as Extract<
      WorkAction,
      { kind: "create" }
    >;
    expect(detail.catalogue_task_id).toBe("task-1");
    expect(detail.title).toBeUndefined();
    expect(detail.assigned_to).toBeUndefined();
    expect(detail.due_date).toBeUndefined();
  });
});

describe("<boat-work-item-sheet> todo actions", () => {
  it("starts work", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "todo" }),
    });
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="start"]').click();
    expect((await event).detail).toEqual({ kind: "start", id: "w1" });
  });

  it("cancels with the typed reason", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "todo" }),
    });
    setValue(q<HTMLInputElement>(el, "#reason"), "no longer needed");
    await update(el);
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="cancel"]').click();
    expect((await event).detail).toEqual({
      kind: "cancel",
      id: "w1",
      reason: "no longer needed",
    });
  });

  it("blocks with a reason carried as block_reason", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "todo" }),
    });
    setValue(q<HTMLInputElement>(el, "#reason"), "waiting on part");
    await update(el);
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="block"]').click();
    expect((await event).detail).toEqual({
      kind: "block",
      id: "w1",
      block_reason: "waiting on part",
    });
  });

  it("claims to the selected crew member (disabled until chosen)", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "todo", assigned_to: null }),
      crew: CREW,
    });
    const claim = q<HTMLButtonElement>(el, '[data-action="claim"]');
    expect(claim.disabled).toBe(true);
    setSelect(q<HTMLSelectElement>(el, "#assignee"), "crew-2");
    await update(el);
    expect(claim.disabled).toBe(false);
    const event = nextEvent<WorkAction>(el, "bm-action");
    claim.click();
    expect((await event).detail).toEqual({
      kind: "claim",
      id: "w1",
      crew_id: "crew-2",
    });
  });
});

describe("<boat-work-item-sheet> in_progress actions", () => {
  it("submits for review with completion notes", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "in_progress" }),
    });
    setValue(q<HTMLTextAreaElement>(el, "#notes"), "Replaced impeller");
    await update(el);
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="submit"]').click();
    expect((await event).detail).toEqual({
      kind: "submit",
      id: "w1",
      completion_notes: "Replaced impeller",
    });
  });

  it("submits with no notes as undefined", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "in_progress" }),
    });
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="submit"]').click();
    const detail = (await event).detail as Extract<
      WorkAction,
      { kind: "submit" }
    >;
    expect(detail.completion_notes).toBeUndefined();
  });
});

describe("<boat-work-item-sheet> review actions", () => {
  it("seeds the catalogue default verifier and enables Verify", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "review" }),
      verifiers: VERIFIERS,
      defaultVerifier: "crew-1",
    });
    expect(q<HTMLSelectElement>(el, "#verifier").value).toBe("crew-1");
    expect(q<HTMLButtonElement>(el, '[data-action="verify"]').disabled).toBe(
      false,
    );
  });

  it("keeps Verify disabled until a verifier is chosen", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "review" }),
      verifiers: VERIFIERS,
      defaultVerifier: null,
    });
    const verify = q<HTMLButtonElement>(el, '[data-action="verify"]');
    expect(verify.disabled).toBe(true);
    setSelect(q<HTMLSelectElement>(el, "#verifier"), "crew-2");
    await update(el);
    expect(verify.disabled).toBe(false);
  });

  it("verifies with the verifier and notes", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "review" }),
      verifiers: VERIFIERS,
      defaultVerifier: "crew-1",
    });
    setValue(q<HTMLTextAreaElement>(el, "#vnotes"), "looks good");
    await update(el);
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="verify"]').click();
    expect((await event).detail).toEqual({
      kind: "verify",
      id: "w1",
      verified_by: "crew-1",
      notes: "looks good",
    });
  });

  it("sends back to in_progress via start", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "review" }),
      verifiers: VERIFIERS,
    });
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="send-back"]').click();
    expect((await event).detail).toEqual({ kind: "start", id: "w1" });
  });
});

describe("<boat-work-item-sheet> blocked / done actions", () => {
  it("resumes a blocked item back into in_progress", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "blocked" }),
    });
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="resume"]').click();
    expect((await event).detail).toEqual({
      kind: "unblock",
      id: "w1",
      target: "in_progress",
    });
  });

  it("moves a deferred item back to todo", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "deferred" }),
    });
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="unblock"]').click();
    expect((await event).detail).toEqual({
      kind: "unblock",
      id: "w1",
      target: "todo",
    });
  });

  it("reopens a done item as a corrective work item", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "done" }),
    });
    setValue(q<HTMLInputElement>(el, "#reason"), "leak returned");
    await update(el);
    const event = nextEvent<WorkAction>(el, "bm-action");
    q<HTMLButtonElement>(el, '[data-action="reopen"]').click();
    expect((await event).detail).toEqual({
      kind: "reopen",
      id: "w1",
      reason: "leak returned",
    });
  });
});

describe("<boat-work-item-sheet> seed-guard and close", () => {
  it("preserves in-flight edits across a same-item refresh, reseeds on a new item", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "in_progress" }),
    });
    setValue(q<HTMLTextAreaElement>(el, "#notes"), "half done");
    await update(el);

    // Same id, fresh object (mirrors a refresh after an action): edits survive.
    el.item = workItemRecord({ id: "w1", status: "in_progress" });
    await update(el);
    expect(q<HTMLTextAreaElement>(el, "#notes").value).toBe("half done");

    // A different item reseeds the form.
    el.item = workItemRecord({ id: "w2", status: "in_progress" });
    await update(el);
    expect(q<HTMLTextAreaElement>(el, "#notes").value).toBe("");
  });

  it("emits bm-close from the Close button", async () => {
    const el = await mount<BoatWorkItemSheet>("boat-work-item-sheet", {
      item: workItemRecord({ id: "w1", status: "todo" }),
    });
    const event = nextEvent(el, "bm-close");
    const close = [
      ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".actions .btn"),
    ].find((b) => b.textContent!.trim() === "Close")!;
    close.click();
    await event;
    expect(true).toBe(true);
  });
});
