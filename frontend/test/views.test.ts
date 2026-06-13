import { describe, it, expect, afterEach } from "vitest";
import { BoatSystemsView } from "../src/systems-view";
import { BoatEquipmentView } from "../src/equipment-view";
import { BoatInventoryView } from "../src/inventory-view";
import { BoatCatalogueView } from "../src/catalogue-view";
import { BoatWorkBoardView } from "../src/work-board-view";
import { BoatSuggestionsView } from "../src/suggestions-view";
import { BoatLogbookView } from "../src/logbook-view";
import {
  catalogueRecord,
  equipmentRecord,
  inventoryRecord,
  logRecord,
  mount,
  nextEvent,
  suggestionRecord,
  systemRecord,
  workItemRecord,
} from "./helpers";
import type {
  CatalogueTaskRecord,
  EquipmentRecord,
  InventoryRecord,
  SuggestionRecord,
  SystemRecord,
  WorkItemRecord,
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

describe("<boat-catalogue-view>", () => {
  it("shows an empty state with no tasks", async () => {
    const el = await mount<BoatCatalogueView>("boat-catalogue-view", {
      tasks: [],
    });
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("li")).toHaveLength(0);
  });

  it("renders title, resolved systems, duration and skill chips", async () => {
    const el = await mount<BoatCatalogueView>("boat-catalogue-view", {
      tasks: [
        catalogueRecord({
          id: "t1",
          title: "Service raw-water pump",
          system_refs: ["s1"],
          estimated_duration_minutes: 45,
          required_skills: ["mechanical"],
        }),
      ],
      systemNames: { s1: "Propulsion" },
    });
    const row = el.shadowRoot!.querySelector("li")!;
    expect(row.textContent).toContain("Service raw-water pump");
    expect(row.textContent).toContain("Propulsion");
    expect(row.textContent).toContain("45 min");
    expect(row.querySelector(".chip")!.textContent).toContain("mechanical");
  });

  it("shows the resolved last-completed summary, or Never completed", async () => {
    const el = await mount<BoatCatalogueView>("boat-catalogue-view", {
      tasks: [
        catalogueRecord({ id: "t1", title: "Done one" }),
        catalogueRecord({ id: "t2", title: "Fresh one" }),
      ],
      lastCompleted: {
        t1: { date: "2024-05-01 11:00", verifierName: "Sam", notes: null },
      },
    });
    const rows = el.shadowRoot!.querySelectorAll("li");
    expect(rows[0].textContent).toContain("Last done 2024-05-01 11:00");
    expect(rows[0].textContent).toContain("Sam");
    expect(rows[1].textContent).toContain("Never completed");
  });

  it("emits bm-edit with the tapped record", async () => {
    const target = catalogueRecord({ id: "t9", title: "Inspect windlass" });
    const el = await mount<BoatCatalogueView>("boat-catalogue-view", {
      tasks: [target],
    });
    const event = nextEvent<CatalogueTaskRecord>(el, "bm-edit");
    el.shadowRoot!.querySelector<HTMLLIElement>("li")!.click();
    expect((await event).detail).toBe(target);
  });
});

describe("<boat-work-board-view>", () => {
  it("shows an empty state when there is no active work", async () => {
    const el = await mount<BoatWorkBoardView>("boat-work-board-view", {
      items: [],
    });
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".board")).toBeNull();
  });

  function cards(el: HTMLElement, status: string): HTMLElement[] {
    return [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>(
        `.col[data-status="${status}"] .card`,
      ),
    ];
  }

  it("groups items into their status columns with a count badge", async () => {
    const el = await mount<BoatWorkBoardView>("boat-work-board-view", {
      items: [
        workItemRecord({ id: "w1", status: "todo", title: "A" }),
        workItemRecord({ id: "w2", status: "todo", title: "B" }),
        workItemRecord({ id: "w3", status: "review", title: "C" }),
      ],
    });
    expect(cards(el, "todo")).toHaveLength(2);
    expect(cards(el, "review")).toHaveLength(1);
    expect(cards(el, "in_progress")).toHaveLength(0);
    const todoCol = el.shadowRoot!.querySelector(
      '.col[data-status="todo"] .col-count',
    )!;
    expect(todoCol.textContent!.trim()).toBe("2");
  });

  it("omits cancelled work — it is terminal and has no column", async () => {
    const el = await mount<BoatWorkBoardView>("boat-work-board-view", {
      items: [
        workItemRecord({ id: "w1", status: "todo", title: "Live" }),
        workItemRecord({ id: "w2", status: "cancelled", title: "Scrapped" }),
      ],
    });
    expect(el.shadowRoot!.textContent).not.toContain("Scrapped");
    expect(
      el.shadowRoot!.querySelector('.col[data-status="cancelled"]'),
    ).toBeNull();
  });

  it("resolves the assignee name, due date and block reason on a card", async () => {
    const el = await mount<BoatWorkBoardView>("boat-work-board-view", {
      items: [
        workItemRecord({
          id: "w1",
          status: "blocked",
          title: "Service pump",
          assigned_to: "crew-1",
          due_date: "2024-06-01",
          block_reason: "waiting on impeller",
        }),
      ],
      crewNames: { "crew-1": "Sam" },
    });
    const card = cards(el, "blocked")[0];
    expect(card.textContent).toContain("Service pump");
    expect(card.textContent).toContain("Sam");
    expect(card.textContent).toContain("2024-06-01");
    expect(card.textContent).toContain("waiting on impeller");
  });

  it("emits bm-edit with the tapped record", async () => {
    const target = workItemRecord({ id: "w9", status: "todo", title: "Tap me" });
    const el = await mount<BoatWorkBoardView>("boat-work-board-view", {
      items: [target],
    });
    const event = nextEvent<WorkItemRecord>(el, "bm-edit");
    cards(el, "todo")[0].click();
    expect((await event).detail).toBe(target);
  });
});

describe("<boat-suggestions-view>", () => {
  it("shows an empty state with no suggestions", async () => {
    const el = await mount<BoatSuggestionsView>("boat-suggestions-view", {
      suggestions: [],
    });
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("li")).toHaveLength(0);
  });

  it("renders title, reason, a human source label and the context chip", async () => {
    const el = await mount<BoatSuggestionsView>("boat-suggestions-view", {
      suggestions: [
        suggestionRecord({
          title: "Restock impellers",
          source: "inventory",
          reason: "Stock 1 <= reorder level 2",
          context_label: "Impeller",
        }),
      ],
    });
    const row = el.shadowRoot!.querySelector("li")!;
    expect(row.textContent).toContain("Restock impellers");
    expect(row.textContent).toContain("Stock 1 <= reorder level 2");
    // Source token is mapped to a friendly label, not shown raw.
    expect(row.textContent).toContain("Low stock");
    expect(row.textContent).not.toContain("inventory");
    expect(row.textContent).toContain("Impeller");
  });

  it("falls back to the raw source token for an unknown source", async () => {
    const el = await mount<BoatSuggestionsView>("boat-suggestions-view", {
      suggestions: [suggestionRecord({ source: "future_source" })],
    });
    expect(el.shadowRoot!.querySelector(".chip")!.textContent).toContain(
      "future_source",
    );
  });

  it("offers an Apply button for actionable suggestions", async () => {
    const el = await mount<BoatSuggestionsView>("boat-suggestions-view", {
      suggestions: [suggestionRecord({ already_open: false })],
    });
    expect(el.shadowRoot!.querySelector("button.apply")).not.toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("On board");
  });

  it("shows an On board chip (no Apply) when work is already open", async () => {
    const el = await mount<BoatSuggestionsView>("boat-suggestions-view", {
      suggestions: [suggestionRecord({ already_open: true })],
    });
    expect(el.shadowRoot!.querySelector("button.apply")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("On board");
  });

  it("emits bm-apply with the tapped suggestion", async () => {
    const target = suggestionRecord({
      catalogue_task_id: "task-9",
      title: "Service windlass",
    });
    const el = await mount<BoatSuggestionsView>("boat-suggestions-view", {
      suggestions: [target],
    });
    const event = nextEvent<SuggestionRecord>(el, "bm-apply");
    el.shadowRoot!.querySelector<HTMLButtonElement>("button.apply")!.click();
    expect((await event).detail).toBe(target);
  });
});

describe("<boat-logbook-view>", () => {
  it("shows an empty state with no entries", async () => {
    const el = await mount<BoatLogbookView>("boat-logbook-view", {
      entries: [],
    });
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("li")).toHaveLength(0);
  });

  it("resolves the task title and verifier, showing the local date and tz", async () => {
    const el = await mount<BoatLogbookView>("boat-logbook-view", {
      entries: [
        logRecord({
          catalogue_task_id: "t1",
          verified_by: "crew-1",
          completed_by: "crew-1",
          completed_at_local: "2024-05-01 11:00",
          timezone_at_completion: "Europe/London",
          notes: "Replaced impeller",
        }),
      ],
      taskTitles: { t1: "Service raw-water pump" },
      crewNames: { "crew-1": "Sam" },
    });
    const row = el.shadowRoot!.querySelector("li")!;
    expect(row.textContent).toContain("Service raw-water pump");
    expect(row.textContent).toContain("2024-05-01 11:00");
    expect(row.querySelector(".chip")!.textContent).toContain("Europe/London");
    // Same person did and verified the work: shown once, not duplicated.
    expect(row.textContent).toContain("Verified by Sam");
    expect(row.textContent).not.toContain("Done by");
    expect(row.textContent).toContain("Replaced impeller");
  });

  it("names the doer separately when they differ from the verifier", async () => {
    const el = await mount<BoatLogbookView>("boat-logbook-view", {
      entries: [logRecord({ verified_by: "crew-1", completed_by: "crew-2" })],
      crewNames: { "crew-1": "Sam", "crew-2": "Alex" },
    });
    expect(el.shadowRoot!.querySelector("li")!.textContent).toContain(
      "Done by Alex · verified by Sam",
    );
  });

  it("falls back to a generic title when the task is not resolvable", async () => {
    const el = await mount<BoatLogbookView>("boat-logbook-view", {
      entries: [logRecord({ catalogue_task_id: "gone" })],
    });
    expect(el.shadowRoot!.querySelector(".name")!.textContent).toContain(
      "Maintenance",
    );
  });
});
