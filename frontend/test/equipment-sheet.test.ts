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

describe("<boat-equipment-sheet> nested system create", () => {
  it("emits bm-create-system when the inline add is tapped", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: SYSTEMS,
    });
    const event = nextEvent(el, "bm-create-system");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".addnew")!.click();
    await event; // resolves => emitted
  });

  it("selects a freshly-created system id on injection", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      // The shell refreshes options first, so the new system is pickable.
      systems: [...SYSTEMS, { id: "s9", name: "Rigging" }],
    });
    el.setSystem = { token: 1, id: "s9" };
    await update(el);
    expect(input(el, "system").value).toBe("s9");

    const event = nextEvent<EquipmentDraft>(el, "bm-save");
    const name = input(el, "name");
    name.value = "Backstay tensioner";
    name.dispatchEvent(new InputEvent("input"));
    await update(el);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    expect((await event).detail.system_id).toBe("s9");
  });

  it("applies a setSystem token only once", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: [...SYSTEMS, { id: "s9", name: "Rigging" }],
    });
    el.setSystem = { token: 1, id: "s9" };
    await update(el);
    // User changes their mind and picks a different system manually.
    const select = input(el, "system") as unknown as HTMLSelectElement;
    select.value = "s1";
    select.dispatchEvent(new Event("change"));
    await update(el);
    // A new object carrying the already-applied token must not override it.
    el.setSystem = { token: 1, id: "s9" };
    await update(el);
    expect(input(el, "system").value).toBe("s1");
  });

  it("preserves the in-flight draft when injecting (no reseed)", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: [...SYSTEMS, { id: "s9", name: "Rigging" }],
    });
    const name = input(el, "name");
    name.value = "Backstay tensioner";
    name.dispatchEvent(new InputEvent("input"));
    await update(el);

    el.setSystem = { token: 1, id: "s9" };
    await update(el);

    expect(input(el, "name").value).toBe("Backstay tensioner");
  });

  it("hides the scrim when behind a nested create", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: SYSTEMS,
      behind: true,
    });
    expect(
      el.shadowRoot!.querySelector(".scrim")!.classList.contains("behind"),
    ).toBe(true);
  });
});

describe("<boat-equipment-sheet> media", () => {
  it("renders the capture child in save-first (no-add) mode on create", async () => {
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: null,
      systems: SYSTEMS,
    });
    const capture = el.shadowRoot!.querySelector("boat-media-capture") as {
      canAdd: boolean;
    } | null;
    expect(capture).not.toBeNull();
    // Attaching needs a persisted target id, so create mode cannot add yet.
    expect(capture!.canAdd).toBe(false);
  });

  it("passes resolved media through and enables add in edit mode", async () => {
    const media = [
      { id: "d1", filename: "pump.jpg", kind: "image", url: "/m/d1" },
    ];
    const el = await mount<BoatEquipmentSheet>("boat-equipment-sheet", {
      equipment: equipmentRecord({ id: "eq-1" }),
      systems: SYSTEMS,
      media,
    });
    const capture = el.shadowRoot!.querySelector("boat-media-capture") as {
      canAdd: boolean;
      media: unknown[];
    };
    expect(capture.canAdd).toBe(true);
    expect(capture.media).toEqual(media);
  });
});

