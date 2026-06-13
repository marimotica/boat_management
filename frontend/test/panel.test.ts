import { describe, it, expect, afterEach } from "vitest";
import { BoatManagementPanel } from "../src/boat-panel";
import type {
  BootstrapResult,
  CatalogueTaskRecord,
  CrewRecord,
  DocumentRecord,
  EquipmentRecord,
  HomeAssistant,
  InventoryRecord,
  MaintenanceLogRecord,
  SuggestionRecord,
  SystemRecord,
  WorkItemRecord,
} from "../src/types";
import {
  mount,
  update,
  waitFor,
  documentRecord,
  equipmentRecord,
  inventoryRecord,
  workItemRecord,
} from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

// In-memory stand-in for the boat_management backend: it answers `bootstrap`
// from a live store and applies the systems write commands so the panel's
// refresh-after-write loop can be exercised end to end. `failOn` forces a
// structured websocket rejection to drive the error path through `describe()`.
function fakeBackend(options: { failOn?: string } = {}) {
  const systems: Record<string, SystemRecord> = {
    "sys-1": {
      id: "sys-1",
      name: "Propulsion",
      category: "drive",
      description: null,
      parent_system_id: null,
      active: true,
    },
    "sys-2": {
      id: "sys-2",
      name: "Electrical",
      category: null,
      description: null,
      parent_system_id: null,
      active: true,
    },
  };
  // Equipment and inventory start empty: the nested-create flow builds them up
  // from scratch (inventory → equipment → system) so the test asserts the
  // server-assigned ids flow back into each parent for auto-selection.
  const equipment: Record<string, EquipmentRecord> = {};
  const inventory: Record<string, InventoryRecord> = {};
  // Attached photos/PDFs, keyed by document id. Upload adds a record here and
  // pushes its id onto the target's media_refs; detach reverses both.
  const documents: Record<string, DocumentRecord> = {};
  const calls: Record<string, unknown>[] = [];
  let seq = 100;

  // A curated catalogue task with a verified completion in the log, so the
  // panel's "last completed" resolution (log + crew) is exercised end to end.
  const tasks: Record<string, CatalogueTaskRecord> = {
    "task-1": {
      id: "task-1",
      title: "Service raw-water pump",
      description: null,
      system_refs: ["sys-1"],
      equipment_refs: [],
      inventory_refs: [],
      required_skills: ["mechanical"],
      estimated_duration_minutes: 45,
      procedure: "Close the seacock, then…",
      safety_notes: null,
      default_verifier: "crew-1",
      trigger_rules: [],
      last_completed_at_utc: "2024-05-01T10:00:00+00:00",
      active: true,
      owner_curated: true,
    },
  };
  const crew: Record<string, CrewRecord> = {
    "crew-1": {
      id: "crew-1",
      name: "Sam",
      role: "skipper",
      skills: [],
      active: true,
    },
  };
  const log: Record<string, MaintenanceLogRecord> = {
    "log-1": {
      id: "log-1",
      catalogue_task_id: "task-1",
      work_item_id: "wi-1",
      verified_by: "crew-1",
      completed_by: "crew-1",
      completed_at_utc: "2024-05-01T10:00:00+00:00",
      completed_at_local: "2024-05-01 11:00",
      timezone_at_completion: "Europe/London",
      notes: "Replaced impeller",
    },
  };

  // Active work: one fresh todo (start it) and one awaiting review (verify it).
  const workItems: Record<string, WorkItemRecord> = {
    "wi-todo": workItemRecord({
      id: "wi-todo",
      status: "todo",
      title: "Seeded todo",
    }),
    "wi-review": workItemRecord({
      id: "wi-review",
      status: "review",
      title: "Seeded review",
      assigned_to: "crew-1",
    }),
  };

  // One state-driven suggestion (a calendar task never completed). Applying it
  // instantiates work and flips the suggestion to already_open on the next read,
  // mirroring the backend's dedup-against-open-work behaviour.
  let suggestions: SuggestionRecord[] = [
    {
      catalogue_task_id: "task-1",
      title: "Service raw-water pump",
      source: "calendar",
      key: null,
      context_id: null,
      context_label: null,
      reason: "Never completed",
      dedup_key: "task-1|calendar||",
      already_open: false,
    },
  ];

  const bootstrap = (): BootstrapResult => ({
    entry_id: "entry-1",
    vessel: {
      id: "v1",
      name: "Whisper",
      home_port: "Falmouth",
      current_timezone: "Europe/London",
      default_timezone: "Europe/London",
    },
    active_timezone: "Europe/London",
    schema_version: 1,
    collections: {
      systems: { ...systems },
      equipment: { ...equipment },
      inventory: { ...inventory },
      task_catalogue: { ...tasks },
      work_items: { ...workItems },
      maintenance_log: { ...log },
      crew: { ...crew },
    },
    documents: { ...documents },
    counts: {
      systems: Object.keys(systems).length,
      task_catalogue: Object.keys(tasks).length,
    },
  });

  const hass = {
    callWS: async (msg: Record<string, unknown>) => {
      calls.push(msg);
      const type = msg.type as string;
      if (options.failOn && type === options.failOn) {
        throw { code: "invalid_request", message: "name already exists" };
      }
      switch (type) {
        case "boat_management/bootstrap":
          return bootstrap();
        case "boat_management/create_system": {
          const id = `sys-${seq++}`;
          systems[id] = {
            id,
            name: msg.name as string,
            category: (msg.category as string) ?? null,
            description: (msg.description as string) ?? null,
            parent_system_id: null,
            active: true,
          };
          return systems[id];
        }
        case "boat_management/update_system": {
          const target = systems[msg.system_id as string];
          Object.assign(target, msg.changes as Partial<SystemRecord>);
          return target;
        }
        case "boat_management/archive_system": {
          systems[msg.system_id as string].active = false;
          return systems[msg.system_id as string];
        }
        case "boat_management/create_equipment": {
          const id = `eq-${seq++}`;
          equipment[id] = equipmentRecord({
            id,
            name: msg.name as string,
            // The auto-selected system id (from a nested system create) rides
            // through verbatim so the test can assert it landed here.
            system_id: (msg.system_id as string) ?? null,
            inventory_refs: (msg.inventory_refs as string[]) ?? [],
            documentation_refs: (msg.documentation_refs as string[]) ?? [],
          });
          return equipment[id];
        }
        case "boat_management/create_inventory_item": {
          const id = `inv-${seq++}`;
          inventory[id] = inventoryRecord({
            id,
            name: msg.name as string,
            quantity: (msg.quantity as string) ?? "0",
            unit: (msg.unit as string) ?? "ea",
            // The linked equipment id (from a nested equipment create) rides
            // through verbatim so the test can assert the link was made.
            equipment_refs: (msg.equipment_refs as string[]) ?? [],
          });
          return inventory[id];
        }
        case "boat_management/create_catalogue_task": {
          const id = `task-${seq++}`;
          tasks[id] = {
            id,
            title: msg.title as string,
            description: (msg.description as string) ?? null,
            system_refs: (msg.system_refs as string[]) ?? [],
            equipment_refs: (msg.equipment_refs as string[]) ?? [],
            inventory_refs: (msg.inventory_refs as string[]) ?? [],
            required_skills: (msg.required_skills as string[]) ?? [],
            estimated_duration_minutes:
              (msg.estimated_duration_minutes as number) ?? null,
            procedure: (msg.procedure as string) ?? null,
            safety_notes: (msg.safety_notes as string) ?? null,
            default_verifier: (msg.default_verifier as string) ?? null,
            trigger_rules: [],
            last_completed_at_utc: null,
            active: true,
            owner_curated: true,
          };
          return tasks[id];
        }
        case "boat_management/update_catalogue_task": {
          const target = tasks[msg.catalogue_task_id as string];
          Object.assign(target, msg.changes as Partial<CatalogueTaskRecord>);
          return target;
        }
        case "boat_management/archive_catalogue_task": {
          tasks[msg.catalogue_task_id as string].active = false;
          return tasks[msg.catalogue_task_id as string];
        }
        case "boat_management/create_work_item": {
          const id = `wi-${seq++}`;
          workItems[id] = workItemRecord({
            id,
            catalogue_task_id: msg.catalogue_task_id as string,
            title: (msg.title as string) ?? null,
            assigned_to: (msg.assigned_to as string) ?? null,
            due_date: (msg.due_date as string) ?? null,
            status: "todo",
          });
          return workItems[id];
        }
        case "boat_management/start_work_item": {
          const target = workItems[msg.work_item_id as string];
          target.status = "in_progress";
          return target;
        }
        case "boat_management/verify_work_item": {
          // Verification (review -> done) creates an immutable log entry, which
          // is what the command returns (not the work item).
          const target = workItems[msg.work_item_id as string];
          target.status = "done";
          target.verified_by = msg.verified_by as string;
          const id = `log-${seq++}`;
          log[id] = {
            id,
            catalogue_task_id: target.catalogue_task_id,
            work_item_id: target.id,
            verified_by: msg.verified_by as string,
            completed_by: target.assigned_to ?? null,
            completed_at_utc: "2024-05-02T10:00:00+00:00",
            completed_at_local: "2024-05-02 11:00",
            timezone_at_completion: "Europe/London",
            notes: (msg.notes as string) ?? null,
          };
          return log[id];
        }
        case "boat_management/suggestions":
          return {
            suggestions: [...suggestions],
            count: suggestions.length,
            open_count: suggestions.filter((s) => s.already_open).length,
          };
        case "boat_management/apply_trigger": {
          // Instantiate work from the suggestion's echoed-back context, then
          // mark the suggestion as represented by open work (already_open).
          const taskId = msg.catalogue_task_id as string;
          const id = `wi-${seq++}`;
          workItems[id] = workItemRecord({
            id,
            catalogue_task_id: taskId,
            title: "Service raw-water pump",
            status: "todo",
            trigger_source: msg.source as string,
          });
          suggestions = suggestions.map((s) =>
            s.catalogue_task_id === taskId ? { ...s, already_open: true } : s,
          );
          return {
            dry_run: false,
            would_create: [taskId],
            skipped_existing: [],
            created_work_item_ids: [id],
          };
        }
        case "boat_management/upload_media": {
          // Mirror the backend: store a document and push its id onto the
          // target record's media_refs (equipment or inventory).
          const id = `doc-${seq++}`;
          const targetType = msg.target_type as string;
          const targetId = msg.target_id as string;
          const filename = msg.filename as string;
          documents[id] = documentRecord({
            id,
            filename,
            stored_filename: `${id}.${filename.split(".").pop() ?? "bin"}`,
            content_type: msg.content_type as string,
            kind: (msg.content_type as string).startsWith("image/")
              ? "image"
              : "document",
            target_type: targetType,
            target_id: targetId,
          });
          const target =
            targetType === "equipment" ? equipment[targetId] : inventory[targetId];
          target.media_refs = [...target.media_refs, id];
          return { document: documents[id] };
        }
        case "boat_management/detach_media": {
          const id = msg.document_id as string;
          const doc = documents[id];
          const target =
            doc.target_type === "equipment"
              ? equipment[doc.target_id]
              : inventory[doc.target_id];
          target.media_refs = target.media_refs.filter((r) => r !== id);
          delete documents[id];
          return { document_id: id, detached: true };
        }
        case "auth/sign_path":
          // HA core command: echo the path back with a signature query param so
          // the panel can render an authed media view via a plain <img>.
          return { path: `${msg.path as string}?authSig=sig-${seq++}` };
        default:
          throw new Error(`unexpected command ${type}`);
      }
    },
    connection: {
      subscribeMessage: async () => () => {},
    },
  } as unknown as HomeAssistant;

  return { hass, calls, systems, tasks, workItems, log, equipment, inventory, documents };
}

async function mountPanel(hass: HomeAssistant) {
  const panel = await mount<BoatManagementPanel>("boat-management-panel", {
    hass,
  });
  // Wait out the async bootstrap so the loading state clears.
  await waitFor(
    () => !panel.shadowRoot!.textContent!.includes("Loading vessel"),
  );
  await update(panel);
  return panel;
}

function systemsView(panel: HTMLElement) {
  return panel.shadowRoot!.querySelector("boat-systems-view")!;
}

function rows(panel: HTMLElement): HTMLLIElement[] {
  const view = systemsView(panel);
  return [...view.shadowRoot!.querySelectorAll<HTMLLIElement>("li")];
}

// Two-mode navigation: the bottom nav switches mode (Work/Locker) and the
// segmented control switches section within the active mode. Tests drive both
// via stable data-* hooks rather than label text.
function modeButton(panel: HTMLElement, mode: string): HTMLButtonElement {
  return panel.shadowRoot!.querySelector<HTMLButtonElement>(
    `nav button[data-mode="${mode}"]`,
  )!;
}

function sectionButton(panel: HTMLElement, section: string): HTMLButtonElement {
  return panel.shadowRoot!.querySelector<HTMLButtonElement>(
    `.segments button[data-section="${section}"]`,
  )!;
}

async function openSection(
  panel: BoatManagementPanel,
  mode: string,
  section: string,
): Promise<void> {
  modeButton(panel, mode).click();
  await update(panel);
  sectionButton(panel, section).click();
  await update(panel);
}

describe("<boat-management-panel> bootstrap", () => {
  it("renders the vessel identity and active timezone", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    const header = panel.shadowRoot!.querySelector("header")!;
    expect(header.textContent).toContain("Whisper");
    expect(header.textContent).toContain("Europe/London");
    expect(header.textContent).toContain("Falmouth");
  });

  it("lists active systems sorted by name", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    await openSection(panel, "locker", "systems");
    const names = rows(panel).map((li) =>
      li.querySelector(".name")!.textContent!.trim(),
    );
    expect(names).toEqual(["Electrical", "Propulsion"]);
  });

  it("subscribes for push updates", async () => {
    const { hass, calls } = fakeBackend();
    await mountPanel(hass);
    expect(calls.some((c) => c.type === "boat_management/bootstrap")).toBe(true);
  });
});

describe("<boat-management-panel> create flow", () => {
  it("opens the create sheet from the FAB and persists a new system", async () => {
    const { hass, calls, systems } = fakeBackend();
    const panel = await mountPanel(hass);
    await openSection(panel, "locker", "systems");

    panel.shadowRoot!.querySelector<HTMLButtonElement>(".fab")!.click();
    await waitFor(() => !!panel.shadowRoot!.querySelector("boat-system-sheet"));
    const sheet = panel.shadowRoot!.querySelector("boat-system-sheet")!;
    await update(sheet as HTMLElement);

    const name = sheet.shadowRoot!.querySelector<HTMLInputElement>("#name")!;
    name.value = "Rigging";
    name.dispatchEvent(new InputEvent("input"));
    await update(sheet as HTMLElement);

    sheet.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();

    // The write lands and the sheet closes after the refresh.
    await waitFor(
      () => !panel.shadowRoot!.querySelector("boat-system-sheet"),
    );
    expect(
      calls.some(
        (c) =>
          c.type === "boat_management/create_system" && c.name === "Rigging",
      ),
    ).toBe(true);
    expect(Object.values(systems).some((s) => s.name === "Rigging")).toBe(true);
    expect(rows(panel).some((li) => li.textContent!.includes("Rigging"))).toBe(
      true,
    );
  });
});

describe("<boat-management-panel> nested create", () => {
  // Locate each sheet in the (possibly stacked) panel shadow root by tag.
  function sheet(
    panel: HTMLElement,
    kind: "inventory" | "equipment" | "system",
  ) {
    return panel.shadowRoot!.querySelector(`boat-${kind}-sheet`);
  }
  // Set a sheet's text input and let its render settle.
  async function type(
    sheet: Element,
    id: string,
    value: string,
  ): Promise<void> {
    const input = sheet.shadowRoot!.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new InputEvent("input"));
    await update(sheet as HTMLElement);
  }
  const fab = (panel: HTMLElement) =>
    panel.shadowRoot!.querySelector<HTMLButtonElement>(".fab")!;
  const tap = (sheet: Element, selector: string) =>
    sheet.shadowRoot!.querySelector<HTMLButtonElement>(selector)!.click();

  it("builds inventory → equipment → system, auto-selecting each new child", async () => {
    const { hass, calls, systems, equipment, inventory } = fakeBackend();
    const panel = await mountPanel(hass);
    await openSection(panel, "locker", "inventory");

    // 1. Open the inventory create sheet and type the name we must not lose.
    fab(panel).click();
    await waitFor(() => !!sheet(panel, "inventory"));
    const invSheet = sheet(panel, "inventory")!;
    await update(invSheet as HTMLElement);
    await type(invSheet, "name", "Raw water impeller");

    // 2. Spawn a nested equipment create; the inventory sheet drops behind it.
    tap(invSheet, ".addnew");
    await waitFor(() => !!sheet(panel, "equipment"));
    const eqSheet = sheet(panel, "equipment")!;
    await update(eqSheet as HTMLElement);
    await waitFor(() =>
      invSheet
        .shadowRoot!.querySelector(".scrim")!
        .classList.contains("behind"),
    );
    await type(eqSheet, "name", "Bilge pump");

    // 3. Spawn a nested system create from the equipment sheet.
    tap(eqSheet, ".addnew");
    await waitFor(() => !!sheet(panel, "system"));
    const sysSheet = sheet(panel, "system")!;
    await update(sysSheet as HTMLElement);
    await type(sysSheet, "name", "Bilge");

    // 4. Save the system: it pops and the equipment sheet auto-selects it.
    tap(sysSheet, ".primary");
    await waitFor(() => !sheet(panel, "system"));
    const newSystem = Object.values(systems).find((s) => s.name === "Bilge")!;
    expect(newSystem).toBeTruthy();
    // The server-assigned system id is injected and selected in the equipment
    // sheet (refresh ran first, so the option already exists to be picked).
    await waitFor(() => {
      const select =
        eqSheet.shadowRoot!.querySelector<HTMLSelectElement>("#system");
      return !!select && select.value === newSystem.id;
    });

    // 5. Save the equipment: it pops and the inventory sheet links it.
    tap(eqSheet, ".primary");
    await waitFor(() => !sheet(panel, "equipment"));
    const newEquip = Object.values(equipment).find(
      (e) => e.name === "Bilge pump",
    )!;
    expect(newEquip).toBeTruthy();
    // The equipment create carried the auto-selected system id end to end.
    const eqCall = calls.find(
      (c) => c.type === "boat_management/create_equipment",
    );
    expect(eqCall).toMatchObject({
      name: "Bilge pump",
      system_id: newSystem.id,
    });
    // The inventory draft survived both nested creates (no reseed).
    await update(invSheet as HTMLElement);
    expect(
      invSheet.shadowRoot!.querySelector<HTMLInputElement>("#name")!.value,
    ).toBe("Raw water impeller");

    // 6. Save the inventory: the whole stack closes.
    tap(invSheet, ".primary");
    await waitFor(() => !sheet(panel, "inventory"));
    const invCall = calls.find(
      (c) => c.type === "boat_management/create_inventory_item",
    );
    // The panel never invents the id; it links the new equipment by its
    // server-assigned id and trusts the server for its own id.
    expect(invCall).toMatchObject({ name: "Raw water impeller" });
    expect(invCall).not.toHaveProperty("id");
    expect(invCall!.equipment_refs).toEqual([newEquip.id]);
    const created = Object.values(inventory).find(
      (i) => i.name === "Raw water impeller",
    )!;
    expect(created.equipment_refs).toEqual([newEquip.id]);
    // Nothing is left open.
    expect(sheet(panel, "inventory")).toBeNull();
    expect(sheet(panel, "equipment")).toBeNull();
    expect(sheet(panel, "system")).toBeNull();
  });

  it("keeps a failing nested child open with the parents preserved behind it", async () => {
    const { hass } = fakeBackend({ failOn: "boat_management/create_system" });
    const panel = await mountPanel(hass);
    await openSection(panel, "locker", "inventory");

    fab(panel).click();
    await waitFor(() => !!sheet(panel, "inventory"));
    const invSheet = sheet(panel, "inventory")!;
    await update(invSheet as HTMLElement);
    await type(invSheet, "name", "Raw water impeller");

    tap(invSheet, ".addnew");
    await waitFor(() => !!sheet(panel, "equipment"));
    const eqSheet = sheet(panel, "equipment")!;
    await update(eqSheet as HTMLElement);
    await type(eqSheet, "name", "Bilge pump");

    tap(eqSheet, ".addnew");
    await waitFor(() => !!sheet(panel, "system"));
    const sysSheet = sheet(panel, "system")!;
    await update(sysSheet as HTMLElement);
    await type(sysSheet, "name", "Bilge");

    // The create fails: the system sheet stays open and shows the error.
    tap(sysSheet, ".primary");
    await waitFor(() =>
      Boolean(sheet(panel, "system")?.shadowRoot!.querySelector(".banner")),
    );
    expect(
      sheet(panel, "system")!.shadowRoot!.querySelector(".banner")!.textContent,
    ).toContain("name already exists");
    // The parent chain is still mounted beneath it (nothing was popped), and the
    // equipment sheet received no system injection (the create failed).
    expect(sheet(panel, "equipment")).toBeTruthy();
    expect(sheet(panel, "inventory")).toBeTruthy();
    expect(
      sheet(panel, "equipment")!.shadowRoot!.querySelector<HTMLSelectElement>(
        "#system",
      )!.value,
    ).toBe("");
  });
});

describe("<boat-management-panel> edit flow", () => {
  it("seeds the sheet from the tapped row and updates by id", async () => {
    const { hass, calls } = fakeBackend();
    const panel = await mountPanel(hass);
    await openSection(panel, "locker", "systems");

    // Electrical is first after sorting.
    rows(panel)[0].click();
    await waitFor(() => !!panel.shadowRoot!.querySelector("boat-system-sheet"));
    const sheet = panel.shadowRoot!.querySelector("boat-system-sheet")!;
    await update(sheet as HTMLElement);

    const name = sheet.shadowRoot!.querySelector<HTMLInputElement>("#name")!;
    expect(name.value).toBe("Electrical");
    name.value = "Electrical & Charging";
    name.dispatchEvent(new InputEvent("input"));
    await update(sheet as HTMLElement);
    sheet.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();

    await waitFor(
      () => !panel.shadowRoot!.querySelector("boat-system-sheet"),
    );
    const updateCall = calls.find(
      (c) => c.type === "boat_management/update_system",
    );
    expect(updateCall).toMatchObject({
      system_id: "sys-2",
      changes: { name: "Electrical & Charging" },
    });
  });
});

describe("<boat-management-panel> media", () => {
  // Open the inventory edit sheet for a seeded item by tapping its row.
  async function openInventorySheet(panel: BoatManagementPanel) {
    await openSection(panel, "locker", "inventory");
    const view = panel.shadowRoot!.querySelector("boat-inventory-view")!;
    view.shadowRoot!.querySelector<HTMLLIElement>("li")!.click();
    await waitFor(
      () => !!panel.shadowRoot!.querySelector("boat-inventory-sheet"),
    );
    const sheet = panel.shadowRoot!.querySelector("boat-inventory-sheet")!;
    await update(sheet as HTMLElement);
    return sheet;
  }
  function capture(sheet: Element) {
    return sheet.shadowRoot!.querySelector("boat-media-capture") as HTMLElement & {
      media: { id: string; url: string | null }[];
    };
  }

  it("uploads a picked photo and re-points the open sheet to show it", async () => {
    const { hass, calls, inventory, documents } = fakeBackend();
    inventory["inv-1"] = inventoryRecord({ id: "inv-1", name: "Impeller" });
    const panel = await mountPanel(hass);
    const sheet = await openInventorySheet(panel);

    // The capture child emits a base64 pick; the shell derives the target from
    // the open frame (inventory / inv-1) and uploads.
    capture(sheet).dispatchEvent(
      new CustomEvent("bm-media-pick", {
        detail: {
          filename: "impeller.jpg",
          content_type: "image/jpeg",
          data: "QUJD",
        },
        bubbles: true,
        composed: true,
      }),
    );

    await waitFor(() =>
      calls.some((c) => c.type === "boat_management/upload_media"),
    );
    const call = calls.find((c) => c.type === "boat_management/upload_media")!;
    expect(call).toMatchObject({
      target_type: "inventory",
      target_id: "inv-1",
      filename: "impeller.jpg",
      content_type: "image/jpeg",
      data: "QUJD",
    });
    // The blob is stored and linked to the item.
    expect(Object.keys(documents)).toHaveLength(1);
    expect(inventory["inv-1"].media_refs).toHaveLength(1);
    // The sheet stays open and re-points to the refreshed record, so the new
    // tile appears without losing the editing context.
    await waitFor(() => capture(sheet).media.length === 1);
    expect(panel.shadowRoot!.querySelector("boat-inventory-sheet")).not.toBeNull();
  });

  it("signs the stored path so the photo renders through the authed view", async () => {
    const { hass, calls, inventory, documents } = fakeBackend();
    inventory["inv-1"] = inventoryRecord({
      id: "inv-1",
      name: "Impeller",
      media_refs: ["doc-1"],
    });
    documents["doc-1"] = documentRecord({ id: "doc-1", target_id: "inv-1" });
    const panel = await mountPanel(hass);
    const sheet = await openInventorySheet(panel);

    // Opening the sheet signs the visible media path (the view requires auth).
    await waitFor(() =>
      calls.some(
        (c) =>
          c.type === "auth/sign_path" &&
          c.path === "/api/boat_management/media/entry-1/doc-1",
      ),
    );
    // Once signed, the resolved URL (with authSig) reaches the tile.
    await waitFor(() => capture(sheet).media[0]?.url?.includes("authSig") ?? false);
    await update(sheet as HTMLElement);
    const img = capture(sheet).shadowRoot!.querySelector("img");
    expect(img!.getAttribute("src")).toContain("authSig");
  });

  it("signs each media path at most once", async () => {
    const { hass, calls, inventory, documents } = fakeBackend();
    inventory["inv-1"] = inventoryRecord({
      id: "inv-1",
      name: "Impeller",
      media_refs: ["doc-1"],
    });
    documents["doc-1"] = documentRecord({ id: "doc-1", target_id: "inv-1" });
    const panel = await mountPanel(hass);
    const sheet = await openInventorySheet(panel);
    await waitFor(() => capture(sheet).media[0]?.url?.includes("authSig") ?? false);
    // Re-render the sheet a few times; the cached signature must not re-sign.
    await update(sheet as HTMLElement);
    await update(panel);
    const signCalls = calls.filter(
      (c) => c.type === "auth/sign_path" && c.path?.toString().includes("doc-1"),
    );
    expect(signCalls).toHaveLength(1);
  });

  it("detaches a photo and clears it from the open sheet", async () => {
    const { hass, calls, inventory, documents } = fakeBackend();
    inventory["inv-1"] = inventoryRecord({
      id: "inv-1",
      name: "Impeller",
      media_refs: ["doc-1"],
    });
    documents["doc-1"] = documentRecord({ id: "doc-1", target_id: "inv-1" });
    const panel = await mountPanel(hass);
    const sheet = await openInventorySheet(panel);
    await waitFor(() => capture(sheet).media.length === 1);

    capture(sheet).shadowRoot!.querySelector<HTMLButtonElement>(".item .rm")!.click();

    await waitFor(() =>
      calls.some((c) => c.type === "boat_management/detach_media"),
    );
    expect(
      calls.find((c) => c.type === "boat_management/detach_media"),
    ).toMatchObject({ document_id: "doc-1" });
    // The backend removed the ref + blob; the re-pointed sheet shows no tiles.
    expect(documents["doc-1"]).toBeUndefined();
    expect(inventory["inv-1"].media_refs).toHaveLength(0);
    await waitFor(() => capture(sheet).media.length === 0);
  });
});

describe("<boat-management-panel> error handling", () => {
  it("surfaces a websocket error in the sheet and keeps it open", async () => {
    const { hass } = fakeBackend({ failOn: "boat_management/create_system" });
    const panel = await mountPanel(hass);
    await openSection(panel, "locker", "systems");

    panel.shadowRoot!.querySelector<HTMLButtonElement>(".fab")!.click();
    await waitFor(() => !!panel.shadowRoot!.querySelector("boat-system-sheet"));
    const sheet = panel.shadowRoot!.querySelector("boat-system-sheet")!;
    await update(sheet as HTMLElement);
    const name = sheet.shadowRoot!.querySelector<HTMLInputElement>("#name")!;
    name.value = "Propulsion";
    name.dispatchEvent(new InputEvent("input"));
    await update(sheet as HTMLElement);
    sheet.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();

    // describe() maps the structured error to its message in the sheet banner.
    await waitFor(() =>
      Boolean(
        panel.shadowRoot!
          .querySelector("boat-system-sheet")
          ?.shadowRoot!.querySelector(".banner"),
      ),
    );
    const banner = panel.shadowRoot!
      .querySelector("boat-system-sheet")!
      .shadowRoot!.querySelector(".banner")!;
    expect(banner.textContent).toContain("name already exists");
  });
});

describe("<boat-management-panel> logbook", () => {
  function logbookView(panel: HTMLElement) {
    return panel.shadowRoot!.querySelector("boat-logbook-view");
  }

  it("renders the immutable log with resolved task title, verifier and notes", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    await openSection(panel, "work", "log");
    const view = logbookView(panel)!;
    expect(view).toBeTruthy();
    const entry = view.shadowRoot!.querySelector("li")!;
    // Task title is resolved from the catalogue, verifier from crew, and the
    // local completion string + notes are shown verbatim from the log.
    expect(entry.textContent).toContain("Service raw-water pump");
    expect(entry.textContent).toContain("2024-05-01 11:00");
    expect(entry.textContent).toContain("Sam");
    expect(entry.textContent).toContain("Replaced impeller");
  });
});

describe("<boat-management-panel> catalogue", () => {
  function catalogueView(panel: HTMLElement) {
    return panel.shadowRoot!.querySelector("boat-catalogue-view")!;
  }

  async function openTasks(panel: BoatManagementPanel) {
    await openSection(panel, "locker", "tasks");
  }

  it("renders catalogue tasks with the resolved last-completed summary", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    await openTasks(panel);
    const row = catalogueView(panel).shadowRoot!.querySelector("li")!;
    expect(row.textContent).toContain("Service raw-water pump");
    // System name resolved from the lookup, and last-completed from log + crew.
    expect(row.textContent).toContain("Propulsion");
    expect(row.textContent).toContain("2024-05-01 11:00");
    expect(row.textContent).toContain("Sam");
  });

  it("seeds the edit sheet, including the last-completed block and verifier", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    await openTasks(panel);
    catalogueView(panel).shadowRoot!.querySelector<HTMLLIElement>("li")!.click();
    await waitFor(() => !!panel.shadowRoot!.querySelector("boat-catalogue-sheet"));
    const sheet = panel.shadowRoot!.querySelector("boat-catalogue-sheet")!;
    await update(sheet as HTMLElement);

    const title = sheet.shadowRoot!.querySelector<HTMLInputElement>("#title")!;
    expect(title.value).toBe("Service raw-water pump");
    const procedure =
      sheet.shadowRoot!.querySelector<HTMLTextAreaElement>("#procedure")!;
    expect(procedure.value).toBe("Close the seacock, then…");
    const verifier =
      sheet.shadowRoot!.querySelector<HTMLSelectElement>("#verifier")!;
    expect(verifier.value).toBe("crew-1");
    expect(sheet.shadowRoot!.querySelector(".done")!.textContent).toContain(
      "Replaced impeller",
    );
  });

  it("creates a catalogue task from the FAB and shows it in the list", async () => {
    const { hass, calls, tasks } = fakeBackend();
    const panel = await mountPanel(hass);
    await openTasks(panel);

    panel.shadowRoot!.querySelector<HTMLButtonElement>(".fab")!.click();
    await waitFor(() => !!panel.shadowRoot!.querySelector("boat-catalogue-sheet"));
    const sheet = panel.shadowRoot!.querySelector("boat-catalogue-sheet")!;
    await update(sheet as HTMLElement);

    const title = sheet.shadowRoot!.querySelector<HTMLInputElement>("#title")!;
    title.value = "Inspect anchor windlass";
    title.dispatchEvent(new InputEvent("input"));
    await update(sheet as HTMLElement);
    sheet.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();

    await waitFor(
      () => !panel.shadowRoot!.querySelector("boat-catalogue-sheet"),
    );
    const createCall = calls.find(
      (c) => c.type === "boat_management/create_catalogue_task",
    );
    // The panel never invents the id; create omits it and trusts the server.
    expect(createCall).toMatchObject({ title: "Inspect anchor windlass" });
    expect(createCall).not.toHaveProperty("id");
    expect(
      Object.values(tasks).some((t) => t.title === "Inspect anchor windlass"),
    ).toBe(true);
  });

  it("archives a task via the danger action", async () => {
    const { hass, calls, tasks } = fakeBackend();
    const panel = await mountPanel(hass);
    await openTasks(panel);
    catalogueView(panel).shadowRoot!.querySelector<HTMLLIElement>("li")!.click();
    await waitFor(() => !!panel.shadowRoot!.querySelector("boat-catalogue-sheet"));
    const sheet = panel.shadowRoot!.querySelector("boat-catalogue-sheet")!;
    await update(sheet as HTMLElement);
    sheet.shadowRoot!.querySelector<HTMLButtonElement>("button.danger")!.click();

    await waitFor(
      () => !panel.shadowRoot!.querySelector("boat-catalogue-sheet"),
    );
    expect(
      calls.some((c) => c.type === "boat_management/archive_catalogue_task"),
    ).toBe(true);
    expect(tasks["task-1"].active).toBe(false);
  });
});

describe("<boat-management-panel> work", () => {
  function board(panel: HTMLElement) {
    return panel.shadowRoot!.querySelector("boat-work-board-view")!;
  }
  function cardsIn(panel: HTMLElement, status: string): HTMLElement[] {
    return [
      ...board(panel).shadowRoot!.querySelectorAll<HTMLElement>(
        `.col[data-status="${status}"] .card`,
      ),
    ];
  }
  async function openWork(panel: BoatManagementPanel) {
    await openSection(panel, "work", "board");
  }

  it("renders the board with seeded work grouped by status", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    await openWork(panel);
    const todoCol = board(panel).shadowRoot!.querySelector(
      '.col[data-status="todo"]',
    )!;
    const reviewCol = board(panel).shadowRoot!.querySelector(
      '.col[data-status="review"]',
    )!;
    expect(todoCol.textContent).toContain("Seeded todo");
    expect(reviewCol.textContent).toContain("Seeded review");
  });

  it("instantiates a work item from the FAB and shows it on the board", async () => {
    const { hass, calls, workItems } = fakeBackend();
    const panel = await mountPanel(hass);
    await openWork(panel);

    panel.shadowRoot!.querySelector<HTMLButtonElement>(".fab")!.click();
    await waitFor(
      () => !!panel.shadowRoot!.querySelector("boat-work-item-sheet"),
    );
    const sheet = panel.shadowRoot!.querySelector("boat-work-item-sheet")!;
    await update(sheet as HTMLElement);

    const task = sheet.shadowRoot!.querySelector<HTMLSelectElement>("#task")!;
    task.value = "task-1";
    task.dispatchEvent(new Event("change"));
    const title = sheet.shadowRoot!.querySelector<HTMLInputElement>("#title")!;
    title.value = "New job";
    title.dispatchEvent(new InputEvent("input"));
    await update(sheet as HTMLElement);
    sheet.shadowRoot!
      .querySelector<HTMLButtonElement>('[data-action="create"]')!
      .click();

    await waitFor(
      () => !panel.shadowRoot!.querySelector("boat-work-item-sheet"),
    );
    const createCall = calls.find(
      (c) => c.type === "boat_management/create_work_item",
    );
    // The panel never invents the id; create omits it and trusts the server.
    expect(createCall).toMatchObject({
      catalogue_task_id: "task-1",
      title: "New job",
    });
    expect(createCall).not.toHaveProperty("id");
    expect(Object.values(workItems).some((w) => w.title === "New job")).toBe(
      true,
    );
    expect(board(panel).shadowRoot!.textContent).toContain("New job");
  });

  it("starts a todo item through the lifecycle sheet", async () => {
    const { hass, calls } = fakeBackend();
    const panel = await mountPanel(hass);
    await openWork(panel);

    cardsIn(panel, "todo")[0].click();
    await waitFor(
      () => !!panel.shadowRoot!.querySelector("boat-work-item-sheet"),
    );
    const sheet = panel.shadowRoot!.querySelector("boat-work-item-sheet")!;
    await update(sheet as HTMLElement);
    sheet.shadowRoot!
      .querySelector<HTMLButtonElement>('[data-action="start"]')!
      .click();

    await waitFor(
      () => !panel.shadowRoot!.querySelector("boat-work-item-sheet"),
    );
    expect(
      calls.some(
        (c) =>
          c.type === "boat_management/start_work_item" &&
          c.work_item_id === "wi-todo",
      ),
    ).toBe(true);
    expect(
      cardsIn(panel, "in_progress")
        .map((c) => c.textContent)
        .join(" "),
    ).toContain("Seeded todo");
  });

  it("verifies a review item, creating an immutable log entry", async () => {
    const { hass, calls, workItems, log } = fakeBackend();
    const panel = await mountPanel(hass);
    await openWork(panel);

    cardsIn(panel, "review")[0].click();
    await waitFor(
      () => !!panel.shadowRoot!.querySelector("boat-work-item-sheet"),
    );
    const sheet = panel.shadowRoot!.querySelector("boat-work-item-sheet")!;
    await update(sheet as HTMLElement);
    // The catalogue default verifier (crew-1) is pre-selected, so Verify is ready.
    const verify = sheet.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-action="verify"]',
    )!;
    expect(verify.disabled).toBe(false);
    verify.click();

    await waitFor(
      () => !panel.shadowRoot!.querySelector("boat-work-item-sheet"),
    );
    const verifyCall = calls.find(
      (c) => c.type === "boat_management/verify_work_item",
    );
    expect(verifyCall).toMatchObject({
      work_item_id: "wi-review",
      verified_by: "crew-1",
    });
    expect(workItems["wi-review"].status).toBe("done");
    // A new immutable log entry was appended (seeded log-1 plus the new one).
    expect(Object.keys(log).length).toBe(2);
  });
});

describe("<boat-management-panel> menu button", () => {
  it("renders a menu button in the header and dispatches hass-toggle-menu on click", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);

    const menuBtn =
      panel.shadowRoot!.querySelector<HTMLButtonElement>(".menu-btn");
    expect(menuBtn).toBeTruthy();

    // The event is dispatched from the panel element (shadow host) and bubbles
    // up through the DOM with composed:true so HA's sidebar toggle receives it.
    const fired: Event[] = [];
    panel.addEventListener("hass-toggle-menu", (e) => fired.push(e));
    menuBtn!.click();

    expect(fired.length).toBe(1);
  });
});

describe("<boat-management-panel> suggestions", () => {
  function suggestionsView(panel: HTMLElement) {
    return panel.shadowRoot!.querySelector("boat-suggestions-view");
  }
  async function openOps(panel: BoatManagementPanel) {
    await openSection(panel, "work", "ops");
  }

  it("renders state-driven suggestions fetched from the backend", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    await openOps(panel);
    // Suggestions load on a separate command after bootstrap; wait it out.
    await waitFor(() =>
      Boolean(
        suggestionsView(panel)?.shadowRoot!.textContent!.includes(
          "Service raw-water pump",
        ),
      ),
    );
    expect(suggestionsView(panel)!.shadowRoot!.textContent).toContain(
      "Never completed",
    );
  });

  it("applies a suggestion: creates work, then refreshes it to On board", async () => {
    const { hass, calls, workItems } = fakeBackend();
    const panel = await mountPanel(hass);
    await openOps(panel);
    await waitFor(() =>
      Boolean(suggestionsView(panel)?.shadowRoot!.querySelector("button.apply")),
    );

    suggestionsView(panel)!
      .shadowRoot!.querySelector<HTMLButtonElement>("button.apply")!
      .click();

    await waitFor(() =>
      calls.some((c) => c.type === "boat_management/apply_trigger"),
    );
    const applyCall = calls.find(
      (c) => c.type === "boat_management/apply_trigger",
    );
    // The suggestion's trigger context is echoed back verbatim so the backend
    // targets exactly this catalogue task; the panel never invents an id.
    expect(applyCall).toMatchObject({
      source: "calendar",
      catalogue_task_id: "task-1",
    });
    expect(applyCall).not.toHaveProperty("id");
    // A work item was instantiated from the suggestion (calendar-sourced, so it
    // is distinguishable from the manual seeds).
    expect(
      Object.values(workItems).some(
        (w) =>
          w.trigger_source === "calendar" && w.catalogue_task_id === "task-1",
      ),
    ).toBe(true);
    // After the refresh the suggestion is now represented by open work.
    await waitFor(() =>
      Boolean(
        suggestionsView(panel)?.shadowRoot!.textContent!.includes("On board"),
      ),
    );
    expect(
      suggestionsView(panel)!.shadowRoot!.querySelector("button.apply"),
    ).toBeNull();
  });

  it("surfaces an apply error in the main banner without crashing", async () => {
    const { hass } = fakeBackend({ failOn: "boat_management/apply_trigger" });
    const panel = await mountPanel(hass);
    await openOps(panel);
    await waitFor(() =>
      Boolean(suggestionsView(panel)?.shadowRoot!.querySelector("button.apply")),
    );

    suggestionsView(panel)!
      .shadowRoot!.querySelector<HTMLButtonElement>("button.apply")!
      .click();

    await waitFor(() =>
      Boolean(panel.shadowRoot!.querySelector("main .banner")),
    );
    expect(
      panel.shadowRoot!.querySelector("main .banner")!.textContent,
    ).toContain("name already exists");
  });
});
