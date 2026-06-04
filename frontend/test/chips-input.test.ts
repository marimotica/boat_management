import { describe, it, expect, afterEach } from "vitest";
import { BoatChipsInput } from "../src/chips-input";
import { mount, nextEvent, update } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

function field(el: HTMLElement): HTMLInputElement {
  return el.shadowRoot!.querySelector("input")!;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent("input"));
}

describe("<boat-chips-input>", () => {
  it("renders one chip per value", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", {
      values: ["manual://a", "https://b"],
    });
    expect(el.shadowRoot!.querySelectorAll(".tag")).toHaveLength(2);
  });

  it("adds a trimmed reference on Enter and emits the next array", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", { values: ["a"] });
    const input = field(el);
    type(input, "  b  ");
    const event = nextEvent<string[]>(el, "bm-change");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect((await event).detail).toEqual(["a", "b"]);
  });

  it("treats a comma as a commit key", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", { values: [] });
    const input = field(el);
    type(input, "ref-1");
    const event = nextEvent<string[]>(el, "bm-change");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "," }));
    expect((await event).detail).toEqual(["ref-1"]);
  });

  it("ignores duplicate references", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", { values: ["dup"] });
    const input = field(el);
    let fired = false;
    el.addEventListener("bm-change", () => (fired = true));
    type(input, "dup");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(fired).toBe(false);
  });

  it("ignores an empty/whitespace-only commit", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", { values: [] });
    const input = field(el);
    let fired = false;
    el.addEventListener("bm-change", () => (fired = true));
    type(input, "   ");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(fired).toBe(false);
  });

  it("commits a pending draft on blur", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", { values: [] });
    const input = field(el);
    type(input, "on-blur");
    const event = nextEvent<string[]>(el, "bm-change");
    input.dispatchEvent(new FocusEvent("blur"));
    expect((await event).detail).toEqual(["on-blur"]);
  });

  it("removes a chip by index", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", { values: ["a", "b", "c"] });
    const event = nextEvent<string[]>(el, "bm-change");
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".tag button")[1].click();
    expect((await event).detail).toEqual(["a", "c"]);
  });

  it("disables removal and input while saving", async () => {
    const el = await mount<BoatChipsInput>("boat-chips-input", { values: ["a"] });
    el.disabled = true;
    await update(el);
    expect(field(el).disabled).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLButtonElement>(".tag button")!.disabled,
    ).toBe(true);
  });
});
