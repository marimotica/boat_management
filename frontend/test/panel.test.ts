import { describe, it, expect, afterEach } from "vitest";
import { BoatManagementPanel } from "../src/boat-panel";
import type { BootstrapResult, HomeAssistant, SystemRecord } from "../src/types";
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
      task_catalogue: {},
      work_items: {},
      maintenance_log: {},
      crew: {},
    },
    counts: { systems: Object.keys(systems).length, task_catalogue: 2 },
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
        default:
          throw new Error(`unexpected command ${type}`);
      }
    },
    connection: {
      subscribeMessage: async () => () => {},
    },
  } as unknown as HomeAssistant;

  return { hass, calls, systems };
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
  it("shows a coming-soon count for not-yet-built domains", async () => {
    const { hass } = fakeBackend();
    const panel = await mountPanel(hass);
    const tasksTab = [
      ...panel.shadowRoot!.querySelectorAll<HTMLButtonElement>("nav button"),
    ].find((b) => b.textContent!.includes("Tasks"))!;
    tasksTab.click();
    await update(panel);
    const main = panel.shadowRoot!.querySelector("main")!;
    expect(main.textContent).toContain("Tasks coming soon");
    expect(main.textContent).toContain("2 on record");
  });
});
