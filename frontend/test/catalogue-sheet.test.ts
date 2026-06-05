import { describe, it, expect, afterEach } from "vitest";
import { BoatCatalogueSheet, type CatalogueDraft } from "../src/catalogue-sheet";
import type { MultiselectOption } from "../src/multiselect";
import { catalogueRecord, mount, nextEvent, update } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

const SYSTEMS: MultiselectOption[] = [
  { id: "s1", name: "Propulsion" },
  { id: "s2", name: "Electrical" },
];
const VERIFIERS: MultiselectOption[] = [
  { id: "crew-1", name: "Sam (skipper)" },
  { id: "crew-2", name: "Alex (mate)" },
];

function field<T extends HTMLElement>(el: HTMLElement, id: string): T {
  return el.shadowRoot!.querySelector(`#${id}`)!;
}

describe("<boat-catalogue-sheet> create mode", () => {
  it("titles itself Add, omits Archive and the last-completed block", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      task: null,
      systems: SYSTEMS,
      verifiers: VERIFIERS,
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Add task");
    expect(el.shadowRoot!.querySelector("button.danger")).toBeNull();
    expect(el.shadowRoot!.querySelector(".done")).toBeNull();
  });

  it("lists verifiers plus an Unassigned option", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      task: null,
      verifiers: VERIFIERS,
    });
    const options = el.shadowRoot!.querySelectorAll("#verifier option");
    expect(options).toHaveLength(3);
    expect(options[0].textContent!.trim()).toBe("Unassigned");
    expect(options[1].textContent!.trim()).toBe("Sam (skipper)");
  });

  it("disables Save until a title is entered", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      task: null,
    });
    const save = el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!;
    expect(save.disabled).toBe(true);
    const title = field<HTMLInputElement>(el, "title");
    title.value = "Service raw-water pump";
    title.dispatchEvent(new InputEvent("input"));
    await update(el);
    expect(save.disabled).toBe(false);
  });

  it("emits a draft with no id, the duration as a string, and array refs", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      task: null,
      systems: SYSTEMS,
      verifiers: VERIFIERS,
    });
    const title = field<HTMLInputElement>(el, "title");
    title.value = "Service raw-water pump";
    title.dispatchEvent(new InputEvent("input"));
    const procedure = field<HTMLTextAreaElement>(el, "procedure");
    procedure.value = "Close the seacock, then…";
    procedure.dispatchEvent(new InputEvent("input"));
    const duration = field<HTMLInputElement>(el, "duration");
    duration.value = "45";
    duration.dispatchEvent(new InputEvent("input"));
    await update(el);

    const event = nextEvent<CatalogueDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    const draft = (await event).detail;
    // The panel never invents the id; create omits it.
    expect(draft.id).toBeUndefined();
    expect(draft.title).toBe("Service raw-water pump");
    expect(draft.procedure).toBe("Close the seacock, then…");
    // Duration stays a string; the shell parses it before the write because the
    // `changes` dict bypasses voluptuous coercion.
    expect(draft.estimated_duration_minutes).toBe("45");
    expect(Array.isArray(draft.system_refs)).toBe(true);
    expect(Array.isArray(draft.equipment_refs)).toBe(true);
    expect(Array.isArray(draft.inventory_refs)).toBe(true);
    expect(Array.isArray(draft.required_skills)).toBe(true);
  });
});

describe("<boat-catalogue-sheet> edit mode", () => {
  it("seeds every field including the verifier", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      systems: SYSTEMS,
      verifiers: VERIFIERS,
      task: catalogueRecord({
        id: "t7",
        title: "Service raw-water pump",
        description: "Annual",
        procedure: "Close the seacock, then…",
        safety_notes: "Seacock closed",
        estimated_duration_minutes: 45,
        default_verifier: "crew-1",
      }),
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Edit task");
    expect(field<HTMLInputElement>(el, "title").value).toBe(
      "Service raw-water pump",
    );
    expect(field<HTMLTextAreaElement>(el, "description").value).toBe("Annual");
    expect(field<HTMLTextAreaElement>(el, "procedure").value).toBe(
      "Close the seacock, then…",
    );
    expect(field<HTMLTextAreaElement>(el, "safety").value).toBe("Seacock closed");
    expect(field<HTMLInputElement>(el, "duration").value).toBe("45");
    expect(field<HTMLSelectElement>(el, "verifier").value).toBe("crew-1");
  });

  it("emits bm-save with the id preserved", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      verifiers: VERIFIERS,
      task: catalogueRecord({ id: "t7", title: "Service raw-water pump" }),
    });
    const event = nextEvent<CatalogueDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    expect((await event).detail.id).toBe("t7");
  });

  it("emits bm-archive with the id", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      task: catalogueRecord({ id: "t7" }),
    });
    const event = nextEvent<string>(el, "bm-archive");
    el.shadowRoot!.querySelector<HTMLButtonElement>("button.danger")!.click();
    expect((await event).detail).toBe("t7");
  });

  it("renders the read-only last-completed block when supplied", async () => {
    const el = await mount<BoatCatalogueSheet>("boat-catalogue-sheet", {
      task: catalogueRecord({ id: "t7" }),
      lastCompleted: {
        date: "2024-05-01 11:00",
        verifierName: "Sam",
        notes: "Replaced impeller",
      },
    });
    const done = el.shadowRoot!.querySelector(".done")!;
    expect(done.textContent).toContain("2024-05-01 11:00");
    expect(done.textContent).toContain("Sam");
    expect(done.textContent).toContain("Replaced impeller");
  });
});
