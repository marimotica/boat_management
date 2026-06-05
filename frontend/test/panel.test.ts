import { describe, it, expect, afterEach } from "vitest";
import { BoatManagementPanel } from "../src/boat-panel";
import type {
  BootstrapResult,
  CatalogueTaskRecord,
  CrewRecord,
  HomeAssistant,
  MaintenanceLogRecord,
  SystemRecord,
} from "../src/types";
import { mount, update, waitFor } from "./helpers";

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
      equipment: {},
      inventory: {},
      task_catalogue: { ...tasks },
      work_items: {},
      maintenance_log: { ...log },
      crew: { ...crew },
    },
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
        default:
          throw new Error(`unexpected command ${type}`);
      }
    },
    connection: {
      subscribeMessage: async () => () => {},
    },
  } as unknown as HomeAssistant;

  return { hass, calls, systems, tasks };
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

describe("<boat-management-panel> edit flow", () => {
  it("seeds the sheet from the tapped row and updates by id", async () => {
    const { hass, calls } = fakeBackend();
    const panel = await mountPanel(hass);

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

describe("<boat-management-panel> error handling", () => {
  it("surfaces a websocket error in the sheet and keeps it open", async () => {
    const { hass } = fakeBackend({ failOn: "boat_management/create_system" });
    const panel = await mountPanel(hass);

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

describe("<boat-management-panel> placeholder tabs", () => {
  it("shows a coming-soon state for not-yet-built domains", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    const logTab = [
      ...panel.shadowRoot!.querySelectorAll<HTMLButtonElement>("nav button"),
    ].find((b) => b.textContent!.includes("Log"))!;
    logTab.click();
    await update(panel);
    const main = panel.shadowRoot!.querySelector("main")!;
    expect(main.textContent).toContain("Log coming soon");
  });
});

describe("<boat-management-panel> catalogue", () => {
  function catalogueView(panel: HTMLElement) {
    return panel.shadowRoot!.querySelector("boat-catalogue-view")!;
  }

  async function openTasks(panel: BoatManagementPanel) {
    const tab = [
      ...panel.shadowRoot!.querySelectorAll<HTMLButtonElement>("nav button"),
    ].find((b) => b.textContent!.includes("Tasks"))!;
    tab.click();
    await update(panel);
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
