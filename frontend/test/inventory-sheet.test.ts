import { describe, it, expect, afterEach } from "vitest";
import {
  BoatInventorySheet,
  type InventoryAdjust,
  type InventoryDraft,
} from "../src/inventory-sheet";
import { inventoryRecord, mount, nextEvent, update } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

function q(el: HTMLElement, selector: string): HTMLElement | null {
  return el.shadowRoot!.querySelector(selector);
}

describe("<boat-inventory-sheet> create mode", () => {
  it("offers a direct quantity input and no stepper", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", { inventory: null });
    expect(q(el, "#qty")).not.toBeNull();
    expect(q(el, ".stepctl")).toBeNull();
    expect(q(el, "button.danger")).toBeNull(); // no Mark expired on create
  });

  it("emits a draft with the entered quantity", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", { inventory: null });
    const name = q(el, "#name") as HTMLInputElement;
    name.value = "Impeller";
    name.dispatchEvent(new InputEvent("input"));
    const qty = q(el, "#qty") as HTMLInputElement;
    qty.value = "6";
    qty.dispatchEvent(new InputEvent("input"));
    await update(el);

    const event = nextEvent<InventoryDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    const draft = (await event).detail;
    expect(draft.id).toBeUndefined();
    expect(draft.name).toBe("Impeller");
    expect(draft.quantity).toBe("6");
  });

  it("defaults a blank quantity to 0", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", { inventory: null });
    const name = q(el, "#name") as HTMLInputElement;
    name.value = "Impeller";
    name.dispatchEvent(new InputEvent("input"));
    await update(el);
    const event = nextEvent<InventoryDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    expect((await event).detail.quantity).toBe("0");
  });
});

describe("<boat-inventory-sheet> edit mode: stepper", () => {
  it("shows read-only stock with a stepper instead of a quantity input", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", quantity: "4", unit: "ea" }),
    });
    expect(q(el, "#qty")).toBeNull();
    expect(q(el, ".stepctl")).not.toBeNull();
    expect(q(el, ".stock .big")!.textContent).toContain("4");
  });

  it("emits a positive signed delta on +", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", quantity: "4" }),
    });
    const amount = q(el, ".stepctl input") as HTMLInputElement;
    amount.value = "3";
    amount.dispatchEvent(new InputEvent("input"));
    await update(el);
    const event = nextEvent<InventoryAdjust>(el, "bm-adjust");
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".stepctl button")[1].click();
    expect((await event).detail).toEqual({ id: "i1", delta: "3" });
  });

  it("emits a negative signed delta on −", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", quantity: "4" }),
    });
    const event = nextEvent<InventoryAdjust>(el, "bm-adjust");
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".stepctl button")[0].click();
    expect((await event).detail).toEqual({ id: "i1", delta: "-1" });
  });

  it("ignores a non-positive or non-numeric amount", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", quantity: "4" }),
    });
    let fired = false;
    el.addEventListener("bm-adjust", () => (fired = true));
    const amount = q(el, ".stepctl input") as HTMLInputElement;
    amount.value = "0";
    amount.dispatchEvent(new InputEvent("input"));
    await update(el);
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".stepctl button")[1].click();
    expect(fired).toBe(false);
  });
});

describe("<boat-inventory-sheet> mark expired", () => {
  it("emits bm-mark-expired with the id when stock is healthy", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", expired: false }),
    });
    const event = nextEvent<string>(el, "bm-mark-expired");
    el.shadowRoot!.querySelector<HTMLButtonElement>("button.danger")!.click();
    expect((await event).detail).toBe("i1");
  });

  it("hides the Mark expired action for already-expired stock", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", expired: true }),
    });
    expect(q(el, "button.danger")).toBeNull();
  });
});

describe("<boat-inventory-sheet> save + seed guard", () => {
  it("carries the id through on save in edit mode", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", name: "Impeller" }),
    });
    const event = nextEvent<InventoryDraft>(el, "bm-save");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
    expect((await event).detail.id).toBe("i1");
  });

  it("does NOT clobber in-flight edits when the same item is refreshed", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", name: "Impeller", quantity: "4" }),
    });
    // User renames in the open sheet...
    const name = q(el, "#name") as HTMLInputElement;
    name.value = "Raw water impeller";
    name.dispatchEvent(new InputEvent("input"));
    await update(el);

    // ...meanwhile an adjust refreshes the SAME record (new object, same id).
    el.inventory = inventoryRecord({
      id: "i1",
      name: "Impeller",
      quantity: "9",
    });
    await update(el);

    // The edited name survives; the live stock reflects the refresh.
    expect((q(el, "#name") as HTMLInputElement).value).toBe(
      "Raw water impeller",
    );
    expect(q(el, ".stock .big")!.textContent).toContain("9");
  });

  it("reseeds when the record identity changes", async () => {
    const el = await mount<BoatInventorySheet>("boat-inventory-sheet", {
      inventory: inventoryRecord({ id: "i1", name: "Impeller" }),
    });
    const name = q(el, "#name") as HTMLInputElement;
    name.value = "scratch";
    name.dispatchEvent(new InputEvent("input"));
    await update(el);

    el.inventory = inventoryRecord({
      id: "i2",
      name: "Zinc anode",
    });
    await update(el);
    expect((q(el, "#name") as HTMLInputElement).value).toBe("Zinc anode");
  });
});
