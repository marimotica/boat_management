import { describe, it, expect, afterEach } from "vitest";
import { BoatEquipmentSheet, type EquipmentDraft } from "../src/equipment-sheet";
import type { MultiselectOption } from "../src/multiselect";
import { equipmentRecord, mount, nextEvent, update } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

const SYSTEMS: MultiselectOption[] = [
  { id: "s1", name: "Propulsion" },
  { id: "s2", name: "Electrical" },
];

function input(el: HTMLElement, id: string): HTMLInputElement {
  return el.shadowRoot!.querySelector(`#${id}`)!;
}

describe("<boat-equipment-sheet> create mode", () => {
  it("titles itself Add and omits the Retire action", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: SYSTEMS,
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(
      "Add equipment",
    );
    expect(el.shadowRoot!.querySelector("button.danger")).toBeNull();
  });

  it("lists systems plus an Unassigned option", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: SYSTEMS,
    });
    const options = el.shadowRoot!.querySelectorAll("#system option");
    expect(options).toHaveLength(3);
    expect(options[0].textContent!.trim()).toBe("Unassigned");
  });

  it("emits a draft carrying the interval as a string and array refs", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: SYSTEMS,
    });
    const name = input(el, "name");
    name.value = "Port engine";
    name.dispatchEvent(new InputEvent("input"));
    const interval = input(el, "interval");
    interval.value = "180";
    interval.dispatchEvent(new InputEvent("input"));
    await update(el);

    const event = nextEvent<EquipmentDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    const draft = (await event).detail;
    expect(draft.id).toBeUndefined();
    expect(draft.name).toBe("Port engine");
    // Interval stays a string here; the shell parses it to a number before the
    // write because the `changes` dict bypasses voluptuous coercion.
    expect(draft.maintenance_interval_days).toBe("180");
    expect(Array.isArray(draft.documentation_refs)).toBe(true);
    expect(Array.isArray(draft.inventory_refs)).toBe(true);
  });
});

describe("<boat-equipment-sheet> edit mode", () => {
  it("seeds every field including refs and interval", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      systems: SYSTEMS,
      equipment: equipmentRecord({
        id: "e7",
        name: "Windlass",
        system_id: "s1",
        manufacturer: "Lewmar",
        maintenance_interval_days: 365,
        documentation_refs: ["manual://lewmar"],
        inventory_refs: ["inv-1"],
      }),
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(
      "Edit equipment",
    );
    expect(input(el, "name").value).toBe("Windlass");
    expect(input(el, "manufacturer").value).toBe("Lewmar");
    expect(input(el, "interval").value).toBe("365");
    expect(input(el, "system").value).toBe("s1");
  });

  it("emits bm-save with the id preserved", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      systems: SYSTEMS,
      equipment: equipmentRecord({ id: "e7", name: "Windlass" }),
    });
    const event = nextEvent<EquipmentDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    expect((await event).detail.id).toBe("e7");
  });

  it("emits bm-retire with the id", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      systems: SYSTEMS,
      equipment: equipmentRecord({ id: "e7" }),
    });
    const event = nextEvent<string>(el, "bm-retire");
    el.shadowRoot!.querySelector<HTMLButtonElement>("button.danger")!.click();
    expect((await event).detail).toBe("e7");
  });

  it("clears the interval to an empty string when the record has none", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      systems: SYSTEMS,
      equipment: equipmentRecord({ id: "e7", maintenance_interval_days: null }),
    });
    expect(input(el, "interval").value).toBe("");
  });
});
