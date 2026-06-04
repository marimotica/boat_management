import { describe, it, expect } from "vitest";
import { BoatApi } from "../src/api";
import { fakeHass } from "./helpers";

// The API layer is a thin, auditable mapping onto websocket commands. These
// tests pin the exact message shape — especially `prune`, which must drop blank
// optionals so backend validators never see empty names/refs, while passing
// `changes` dicts through verbatim (callers send explicit nulls to clear).

describe("BoatApi systems", () => {
  it("createSystem sends only non-empty fields", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createSystem({
      name: "Electrical",
      category: "",
      description: undefined,
    });
    expect(calls).toEqual([
      { type: "boat_management/create_system", name: "Electrical" },
    ]);
  });

  it("createSystem keeps populated optionals", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createSystem({
      name: "Electrical",
      category: "power",
      description: "house bank",
    });
    expect(calls[0]).toEqual({
      type: "boat_management/create_system",
      name: "Electrical",
      category: "power",
      description: "house bank",
    });
  });

  it("updateSystem passes the changes dict through verbatim (nulls clear)", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).updateSystem("sys-9", {
      name: "Nav",
      category: null,
    });
    expect(calls[0]).toEqual({
      type: "boat_management/update_system",
      system_id: "sys-9",
      changes: { name: "Nav", category: null },
    });
  });

  it("archiveSystem references the id only", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).archiveSystem("sys-9");
    expect(calls[0]).toEqual({
      type: "boat_management/archive_system",
      system_id: "sys-9",
    });
  });
});

describe("BoatApi equipment", () => {
  it("createEquipment drops empty strings and empty arrays", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createEquipment({
      name: "Port engine",
      system_id: "",
      manufacturer: "Volvo",
      documentation_refs: [],
      inventory_refs: ["inv-1"],
    });
    expect(calls[0]).toEqual({
      type: "boat_management/create_equipment",
      name: "Port engine",
      manufacturer: "Volvo",
      inventory_refs: ["inv-1"],
    });
  });

  it("createEquipment preserves documentation_refs verbatim", async () => {
    const { hass, calls } = fakeHass();
    const refs = ["manual://volvo/d2-55", "https://example/wiring.pdf"];
    await new BoatApi(hass).createEquipment({
      name: "Port engine",
      documentation_refs: refs,
    });
    expect(calls[0]).toMatchObject({ documentation_refs: refs });
  });

  it("updateEquipment passes changes through verbatim", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).updateEquipment("eq-2", {
      maintenance_interval_days: 180,
      system_id: null,
    });
    expect(calls[0]).toEqual({
      type: "boat_management/update_equipment",
      equipment_id: "eq-2",
      changes: { maintenance_interval_days: 180, system_id: null },
    });
  });

  it("retireEquipment omits an absent date", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).retireEquipment("eq-2");
    expect(calls[0]).toEqual({
      type: "boat_management/retire_equipment",
      equipment_id: "eq-2",
    });
  });

  it("retireEquipment includes a provided date", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).retireEquipment("eq-2", "2024-05-01");
    expect(calls[0]).toEqual({
      type: "boat_management/retire_equipment",
      equipment_id: "eq-2",
      retired_date: "2024-05-01",
    });
  });
});

describe("BoatApi inventory", () => {
  it("createInventoryItem prunes blanks but keeps quantity", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createInventoryItem({
      name: "Impeller",
      quantity: "4",
      unit: "ea",
      part_number: "",
      equipment_refs: [],
    });
    expect(calls[0]).toEqual({
      type: "boat_management/create_inventory_item",
      name: "Impeller",
      quantity: "4",
      unit: "ea",
    });
  });

  it("updateInventoryItem passes changes through verbatim", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).updateInventoryItem("inv-3", {
      name: "Impeller",
      reorder_level: null,
    });
    expect(calls[0]).toEqual({
      type: "boat_management/update_inventory_item",
      inventory_id: "inv-3",
      changes: { name: "Impeller", reorder_level: null },
    });
  });

  it("adjustInventoryQuantity sends a signed delta and omits an absent reason", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).adjustInventoryQuantity("inv-3", "-2");
    expect(calls[0]).toEqual({
      type: "boat_management/adjust_inventory_quantity",
      inventory_id: "inv-3",
      delta: "-2",
    });
  });

  it("adjustInventoryQuantity includes a reason when given", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).adjustInventoryQuantity("inv-3", "3", "restock");
    expect(calls[0]).toEqual({
      type: "boat_management/adjust_inventory_quantity",
      inventory_id: "inv-3",
      delta: "3",
      reason: "restock",
    });
  });

  it("markInventoryExpired references the id only", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).markInventoryExpired("inv-3");
    expect(calls[0]).toEqual({
      type: "boat_management/mark_inventory_expired",
      inventory_id: "inv-3",
    });
  });
});
