import { describe, it, expect, afterEach } from "vitest";
import { BoatMultiselect, type MultiselectOption } from "../src/multiselect";
import { mount, nextEvent, update } from "./helpers";

const OPTIONS: MultiselectOption[] = [
  { id: "eq-1", name: "Port engine" },
  { id: "eq-2", name: "Stbd engine" },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<boat-multiselect>", () => {
  it("renders each option and reflects the current selection", async () => {
    const el = await mount<BoatMultiselect>("boat-multiselect", {
      options: OPTIONS,
      selected: ["eq-2"],
    });
    const buttons = el.shadowRoot!.querySelectorAll("button.opt");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("emits bm-change adding an id when an unselected option is tapped", async () => {
    const el = await mount<BoatMultiselect>("boat-multiselect", {
      options: OPTIONS,
      selected: [],
    });
    const event = nextEvent<string[]>(el, "bm-change");
    el.shadowRoot!.querySelector<HTMLButtonElement>("button.opt")!.click();
    expect((await event).detail).toEqual(["eq-1"]);
  });

  it("emits bm-change removing an already-selected id", async () => {
    const el = await mount<BoatMultiselect>("boat-multiselect", {
      options: OPTIONS,
      selected: ["eq-1", "eq-2"],
    });
    const event = nextEvent<string[]>(el, "bm-change");
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.opt")[0].click();
    expect((await event).detail).toEqual(["eq-2"]);
  });

  it("shows an empty hint when there is nothing to link", async () => {
    const el = await mount<BoatMultiselect>("boat-multiselect", { options: [] });
    expect(el.shadowRoot!.textContent).toContain("Nothing to link yet.");
  });

  it("bubbles and composes the event so the shell can catch it", async () => {
    const el = await mount<BoatMultiselect>("boat-multiselect", { options: OPTIONS });
    const event = nextEvent<string[]>(el, "bm-change");
    el.shadowRoot!.querySelector<HTMLButtonElement>("button.opt")!.click();
    const got = await event;
    expect(got.bubbles).toBe(true);
    expect(got.composed).toBe(true);
  });

  it("disables the option buttons while saving", async () => {
    const el = await mount<BoatMultiselect>("boat-multiselect", { options: OPTIONS });
    el.disabled = true;
    await update(el);
    const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      "button.opt",
    );
    expect([...buttons].every((b) => b.disabled)).toBe(true);
  });
});
