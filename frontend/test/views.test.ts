import { describe, it, expect, afterEach } from "vitest";
import { BoatSystemsView } from "../src/systems-view";
import { BoatEquipmentView } from "../src/equipment-view";
import { BoatInventoryView } from "../src/inventory-view";
import { BoatCatalogueView } from "../src/catalogue-view";
import { BoatWorkBoardView } from "../src/work-board-view";
import {
  catalogueRecord,
  equipmentRecord,
  inventoryRecord,
  mount,
  nextEvent,
  systemRecord,
  workItemRecord,
} from "./helpers";
import type {
  CatalogueTaskRecord,
  EquipmentRecord,
  InventoryRecord,
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
