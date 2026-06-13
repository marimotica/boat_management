import { describe, it, expect } from "vitest";
import { BoatApi, mediaPath } from "../src/api";
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

describe("BoatApi catalogue", () => {
  it("createCatalogueTask drops blanks and empty arrays, keeps the title", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createCatalogueTask({
      title: "Service raw-water pump",
      description: "",
      procedure: undefined,
      system_refs: [],
      required_skills: ["mechanical"],
    });
    expect(calls[0]).toEqual({
      type: "boat_management/create_catalogue_task",
      title: "Service raw-water pump",
      required_skills: ["mechanical"],
    });
  });

  it("createCatalogueTask keeps a populated numeric duration and refs", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createCatalogueTask({
      title: "Service raw-water pump",
      estimated_duration_minutes: 45,
      default_verifier: "crew-1",
      system_refs: ["sys-1"],
      equipment_refs: ["eq-1"],
    });
    expect(calls[0]).toEqual({
      type: "boat_management/create_catalogue_task",
      title: "Service raw-water pump",
      estimated_duration_minutes: 45,
      default_verifier: "crew-1",
      system_refs: ["sys-1"],
      equipment_refs: ["eq-1"],
    });
  });

  it("updateCatalogueTask passes the changes dict through verbatim (nulls/empties preserved)", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).updateCatalogueTask("task-9", {
      title: "Service raw-water pump",
      default_verifier: null,
      required_skills: [],
    });
    expect(calls[0]).toEqual({
      type: "boat_management/update_catalogue_task",
      catalogue_task_id: "task-9",
      changes: {
        title: "Service raw-water pump",
        default_verifier: null,
        required_skills: [],
      },
    });
  });

  it("archiveCatalogueTask references the id only", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).archiveCatalogueTask("task-9");
    expect(calls[0]).toEqual({
      type: "boat_management/archive_catalogue_task",
      catalogue_task_id: "task-9",
    });
  });
});

describe("BoatApi work items", () => {
  it("createWorkItem drops blanks but keeps the catalogue task id", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createWorkItem({
      catalogue_task_id: "task-1",
      title: "",
      assigned_to: undefined,
      due_date: "2024-06-01",
    });
    expect(calls[0]).toEqual({
      type: "boat_management/create_work_item",
      catalogue_task_id: "task-1",
      due_date: "2024-06-01",
    });
  });

  it("createWorkItem keeps populated optionals", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).createWorkItem({
      catalogue_task_id: "task-1",
      title: "Service pump",
      assigned_to: "crew-1",
    });
    expect(calls[0]).toEqual({
      type: "boat_management/create_work_item",
      catalogue_task_id: "task-1",
      title: "Service pump",
      assigned_to: "crew-1",
    });
  });

  it("claimWorkItem sends both ids", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).claimWorkItem("wi-1", "crew-2");
    expect(calls[0]).toEqual({
      type: "boat_management/claim_work_item",
      work_item_id: "wi-1",
      crew_id: "crew-2",
    });
  });

  it("startWorkItem references the id only", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).startWorkItem("wi-1");
    expect(calls[0]).toEqual({
      type: "boat_management/start_work_item",
      work_item_id: "wi-1",
    });
  });

  it("submitForReview omits absent notes, includes them when given", async () => {
    const { hass, calls } = fakeHass();
    const api = new BoatApi(hass);
    await api.submitForReview("wi-1");
    expect(calls[0]).toEqual({
      type: "boat_management/submit_for_review",
      work_item_id: "wi-1",
    });
    await api.submitForReview("wi-1", "Replaced impeller");
    expect(calls[1]).toEqual({
      type: "boat_management/submit_for_review",
      work_item_id: "wi-1",
      completion_notes: "Replaced impeller",
    });
  });

  it("blockWorkItem omits an absent reason", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).blockWorkItem("wi-1");
    expect(calls[0]).toEqual({
      type: "boat_management/block_work_item",
      work_item_id: "wi-1",
    });
  });

  it("deferWorkItem and cancelWorkItem carry an optional reason", async () => {
    const { hass, calls } = fakeHass();
    const api = new BoatApi(hass);
    await api.deferWorkItem("wi-1", "after passage");
    expect(calls[0]).toEqual({
      type: "boat_management/defer_work_item",
      work_item_id: "wi-1",
      reason: "after passage",
    });
    await api.cancelWorkItem("wi-1");
    expect(calls[1]).toEqual({
      type: "boat_management/cancel_work_item",
      work_item_id: "wi-1",
    });
  });

  it("unblockWorkItem omits an absent target, includes it when given", async () => {
    const { hass, calls } = fakeHass();
    const api = new BoatApi(hass);
    await api.unblockWorkItem("wi-1");
    expect(calls[0]).toEqual({
      type: "boat_management/unblock_work_item",
      work_item_id: "wi-1",
    });
    await api.unblockWorkItem("wi-1", "in_progress");
    expect(calls[1]).toEqual({
      type: "boat_management/unblock_work_item",
      work_item_id: "wi-1",
      target: "in_progress",
    });
  });

  it("reopenWorkItem carries an optional reason", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).reopenWorkItem("wi-1", "leak returned");
    expect(calls[0]).toEqual({
      type: "boat_management/reopen_work_item",
      work_item_id: "wi-1",
      reason: "leak returned",
    });
  });

  it("verifyWorkItem sends the verifier and omits absent notes", async () => {
    const { hass, calls } = fakeHass();
    const api = new BoatApi(hass);
    await api.verifyWorkItem("wi-1", "crew-1");
    expect(calls[0]).toEqual({
      type: "boat_management/verify_work_item",
      work_item_id: "wi-1",
      verified_by: "crew-1",
    });
    await api.verifyWorkItem("wi-1", "crew-1", "looks good");
    expect(calls[1]).toEqual({
      type: "boat_management/verify_work_item",
      work_item_id: "wi-1",
      verified_by: "crew-1",
      notes: "looks good",
    });
  });
});

describe("BoatApi operational intelligence", () => {
  it("suggestions sends only the command type", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).suggestions();
    expect(calls[0]).toEqual({ type: "boat_management/suggestions" });
  });

  it("applyTrigger (suggestion mode) carries the task id and context", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).applyTrigger({
      source: "inventory",
      catalogue_task_id: "task-1",
      key: "filters",
      context_id: "inv-1",
    });
    expect(calls[0]).toEqual({
      type: "boat_management/apply_trigger",
      source: "inventory",
      catalogue_task_id: "task-1",
      key: "filters",
      context_id: "inv-1",
    });
  });

  it("applyTrigger prunes blank key/context but keeps the source", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).applyTrigger({
      source: "calendar",
      catalogue_task_id: "task-1",
      key: undefined,
      context_id: "",
    });
    expect(calls[0]).toEqual({
      type: "boat_management/apply_trigger",
      source: "calendar",
      catalogue_task_id: "task-1",
    });
  });

  it("applyTrigger (event mode) keeps a numeric value and drops absent optionals", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).applyTrigger({
      source: "engine_hours",
      value: 250,
      key: undefined,
      context_id: undefined,
    });
    expect(calls[0]).toEqual({
      type: "boat_management/apply_trigger",
      source: "engine_hours",
      value: 250,
    });
  });
});

describe("BoatApi media", () => {
  // Upload carries the blob verbatim: every field is required and `data` is the
  // base64 payload, so unlike create flows there is no pruning to apply.
  it("uploadMedia forwards all fields without pruning", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).uploadMedia({
      target_type: "inventory",
      target_id: "inv-1",
      filename: "impeller.jpg",
      content_type: "image/jpeg",
      data: "QUJD",
    });
    expect(calls[0]).toEqual({
      type: "boat_management/upload_media",
      target_type: "inventory",
      target_id: "inv-1",
      filename: "impeller.jpg",
      content_type: "image/jpeg",
      data: "QUJD",
    });
  });

  it("detachMedia references the opaque document id only", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).detachMedia("doc-7");
    expect(calls[0]).toEqual({
      type: "boat_management/detach_media",
      document_id: "doc-7",
    });
  });

  it("signPath calls the core auth command with a default expiry", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).signPath("/api/boat_management/media/entry-1/doc-7");
    expect(calls[0]).toEqual({
      type: "auth/sign_path",
      path: "/api/boat_management/media/entry-1/doc-7",
      expires: 3600,
    });
  });

  it("signPath honours an explicit expiry", async () => {
    const { hass, calls } = fakeHass();
    await new BoatApi(hass).signPath("/x", 60);
    expect(calls[0]).toEqual({ type: "auth/sign_path", path: "/x", expires: 60 });
  });

  // mediaPath mirrors the backend `build_media_url`; the opaque document id is
  // the lookup key, never the filename, so the two never drift.
  it("mediaPath builds the entry-scoped view path from the document id", () => {
    expect(mediaPath("entry-1", "doc-7")).toBe(
      "/api/boat_management/media/entry-1/doc-7",
    );
  });
});
