import { describe, it, expect, afterEach } from "vitest";
import { BoatSystemSheet, type SystemDraft } from "../src/system-sheet";
import { mount, nextEvent, systemRecord, update } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

function input(el: HTMLElement, id: string): HTMLInputElement {
  return el.shadowRoot!.querySelector(`#${id}`)!;
}

function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.value = value;
  field.dispatchEvent(new InputEvent("input"));
}

describe("<boat-system-sheet> create mode", () => {
  it("titles itself Add and omits the Archive action", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", { system: null });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Add system");
    expect(el.shadowRoot!.querySelector("button.danger")).toBeNull();
  });

  it("keeps Save disabled until a name is entered", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", { system: null });
    const save = el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!;
    expect(save.disabled).toBe(true);
    setValue(input(el, "name"), "Rigging");
    await update(el);
    expect(save.disabled).toBe(false);
  });

  it("emits a trimmed draft with no id on save", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", { system: null });
    setValue(input(el, "name"), "  Rigging  ");
    setValue(input(el, "category"), " standing ");
    await update(el);
    const event = nextEvent<SystemDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    expect((await event).detail).toEqual({
      id: undefined,
      name: "Rigging",
      category: "standing",
      description: "",
    });
  });
});

describe("<boat-system-sheet> edit mode", () => {
  it("seeds inputs from the record", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", {
      system: systemRecord({
        id: "s5",
        name: "Nav",
        category: "electronics",
        description: "plotter + radar",
      }),
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Edit system");
    expect(input(el, "name").value).toBe("Nav");
    expect(input(el, "category").value).toBe("electronics");
  });

  it("carries the id through on save", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", {
      system: systemRecord({ id: "s5", name: "Nav" }),
    });
    const event = nextEvent<SystemDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    expect((await event).detail.id).toBe("s5");
  });

  it("emits bm-archive with the id", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", {
      system: systemRecord({ id: "s5" }),
    });
    const event = nextEvent<string>(el, "bm-archive");
    el.shadowRoot!.querySelector<HTMLButtonElement>("button.danger")!.click();
    expect((await event).detail).toBe("s5");
  });
});

describe("<boat-system-sheet> saving + dismissal", () => {
  it("closes when the scrim is tapped", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", { system: null });
    const event = nextEvent(el, "bm-close");
    el.shadowRoot!.querySelector<HTMLElement>(".scrim")!.click();
    await event; // resolves => closed
  });

  it("locks the form and shows progress while saving", async () => {
    const el = await mount<BoatSystemSheet>("boat-system-sheet", {
      system: systemRecord({ id: "s5" }),
    });
    el.saving = true;
    await update(el);
    const save = el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!;
    expect(save.disabled).toBe(true);
    expect(save.textContent!.trim()).toBe("Saving…");
    // A scrim tap must not close while a write is in flight.
    let closed = false;
    el.addEventListener("bm-close", () => (closed = true));
    el.shadowRoot!.querySelector<HTMLElement>(".scrim")!.click();
    expect(closed).toBe(false);
  });
});
