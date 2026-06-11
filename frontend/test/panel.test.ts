import { describe, it, expect, afterEach } from "vitest";
import { BoatManagementPanel } from "../src/boat-panel";
import type {
  BootstrapResult,
  CatalogueTaskRecord,
  CrewRecord,
  HomeAssistant,
  MaintenanceLogRecord,
  SuggestionRecord,
  SystemRecord,
  WorkItemRecord,
} from "../src/types";
import { mount, update, waitFor, workItemRecord } from "./helpers";

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
      equipment: {},
      inventory: {},
      task_catalogue: { ...tasks },
      work_items: { ...workItems },
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
        default:
          throw new Error(`unexpected command ${type}`);
      }
    },
    connection: {
      subscribeMessage: async () => () => {},
    },
  } as unknown as HomeAssistant;

  return { hass, calls, systems, tasks, workItems, log };
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
    const tab = [
      ...panel.shadowRoot!.querySelectorAll<HTMLButtonElement>("nav button"),
    ].find((b) => b.textContent!.includes("Work"))!;
    tab.click();
    await update(panel);
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
    const tab = [
      ...panel.shadowRoot!.querySelectorAll<HTMLButtonElement>("nav button"),
    ].find((b) => b.textContent!.includes("Ops"))!;
    tab.click();
    await update(panel);
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
