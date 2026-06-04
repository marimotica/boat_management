import { describe, it, expect, afterEach } from "vitest";
import { BoatSystemsView } from "../src/systems-view";
import { BoatEquipmentView } from "../src/equipment-view";
import { BoatInventoryView } from "../src/inventory-view";
import {
  equipmentRecord,
  inventoryRecord,
  mount,
  nextEvent,
  systemRecord,
} from "./helpers";
import type {
  EquipmentRecord,
  InventoryRecord,
  SystemRecord,
} from "../src/types";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<boat-systems-view>", () => {
  it("shows an empty state with no systems", async () => {
    const el = await mount<BoatSystemsView>("boat-systems-view", { systems: [] });
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("li")).toHaveLength(0);
  });

  it("renders a row per system with name and category", async () => {
    const el = await mount<BoatSystemsView>("boat-systems-view", {
      systems: [
        systemRecord({ id: "s1", name: "Propulsion", category: "drive" }),
        systemRecord({ id: "s2", name: "Electrical" }),
      ],
    });
    const rows = el.shadowRoot!.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Propulsion");
    expect(rows[0].textContent).toContain("drive");
  });

  it("emits bm-edit with the tapped record", async () => {
    const target = systemRecord({ id: "s2", name: "Electrical" });
    const el = await mount<BoatSystemsView>("boat-systems-view", {
      systems: [systemRecord({ id: "s1" }), target],
    });
    const event = nextEvent<SystemRecord>(el, "bm-edit");
    el.shadowRoot!.querySelectorAll<HTMLLIElement>("li")[1].click();
    expect((await event).detail).toBe(target);
  });
});

describe("<boat-equipment-view>", () => {
  it("resolves the system name from the supplied lookup map", async () => {
    const el = await mount<BoatEquipmentView>("boat-equipment-view", {
      equipment: [equipmentRecord({ id: "e1", system_id: "s1" })],
      systemNames: { s1: "Propulsion" },
    });
    expect(el.shadowRoot!.querySelector("li")!.textContent).toContain(
      "Propulsion",
    );
  });

  it("summarises documentation count with correct pluralisation", async () => {
    const el = await mount<BoatEquipmentView>("boat-equipment-view", {
      equipment: [
        equipmentRecord({ id: "e1", documentation_refs: ["a"] }),
        equipmentRecord({ id: "e2", documentation_refs: ["a", "b"] }),
      ],
    });
    const rows = el.shadowRoot!.querySelectorAll("li");
    expect(rows[0].textContent).toContain("1 document");
    expect(rows[1].textContent).toContain("2 documents");
  });

  it("emits bm-edit with the tapped record", async () => {
    const target = equipmentRecord({ id: "e9", name: "Windlass" });
    const el = await mount<BoatEquipmentView>("boat-equipment-view", { equipment: [target] });
    const event = nextEvent<EquipmentRecord>(el, "bm-edit");
    el.shadowRoot!.querySelector<HTMLLIElement>("li")!.click();
    expect((await event).detail).toBe(target);
  });
});

describe("<boat-inventory-view>", () => {
  it("renders quantity, unit and the LOW badge when below threshold", async () => {
    const el = await mount<BoatInventoryView>("boat-inventory-view", {
      inventory: [
        inventoryRecord({ quantity: "1", unit: "L", reorder_level: "5" }),
      ],
    });
    const row = el.shadowRoot!.querySelector("li")!;
    expect(row.textContent).toContain("1");
    expect(row.textContent).toContain("L");
    expect(row.textContent).toContain("LOW");
    expect(row.textContent).not.toContain("EXPIRED");
  });

  it("shows the EXPIRED badge for expired stock", async () => {
    const el = await mount<BoatInventoryView>("boat-inventory-view", {
      inventory: [inventoryRecord({ expired: true })],
    });
    expect(el.shadowRoot!.querySelector("li")!.textContent).toContain("EXPIRED");
  });

  it("renders no badges for healthy stock", async () => {
    const el = await mount<BoatInventoryView>("boat-inventory-view", {
      inventory: [inventoryRecord({ quantity: "9", reorder_level: "2" })],
    });
    expect(el.shadowRoot!.querySelector(".badges")).toBeNull();
  });

  it("emits bm-edit with the tapped record", async () => {
    const target = inventoryRecord({ id: "i9", name: "Zinc anode" });
    const el = await mount<BoatInventoryView>("boat-inventory-view", { inventory: [target] });
    const event = nextEvent<InventoryRecord>(el, "bm-edit");
    el.shadowRoot!.querySelector<HTMLLIElement>("li")!.click();
    expect((await event).detail).toBe(target);
  });
});
