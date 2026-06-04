import { describe, it, expect } from "vitest";
import { isWsError } from "../src/types";
import { isLowStock } from "../src/inventory-view";
import { inventoryRecord } from "./helpers";

describe("isWsError", () => {
  it("accepts a structured HA websocket error", () => {
    expect(isWsError({ code: "invalid_request", message: "nope" })).toBe(true);
  });

  it("rejects a plain Error (no code)", () => {
    expect(isWsError(new Error("boom"))).toBe(false);
  });

  it("rejects partial shapes and primitives", () => {
    expect(isWsError({ message: "only message" })).toBe(false);
    expect(isWsError({ code: "only_code" })).toBe(false);
    expect(isWsError("string")).toBe(false);
    expect(isWsError(null)).toBe(false);
    expect(isWsError(undefined)).toBe(false);
  });
});

describe("isLowStock", () => {
  it("is false when no threshold is configured", () => {
    expect(
      isLowStock(
        inventoryRecord({ minimum_stock: null, reorder_level: null }),
      ),
    ).toBe(false);
  });

  it("uses reorder_level when present", () => {
    expect(
      isLowStock(inventoryRecord({ quantity: "2", reorder_level: "3" })),
    ).toBe(true);
    expect(
      isLowStock(inventoryRecord({ quantity: "4", reorder_level: "3" })),
    ).toBe(false);
  });

  it("treats an exactly-at-threshold quantity as low (<=)", () => {
    expect(
      isLowStock(inventoryRecord({ quantity: "3", reorder_level: "3" })),
    ).toBe(true);
  });

  it("falls back to minimum_stock when reorder_level is null", () => {
    expect(
      isLowStock(
        inventoryRecord({ quantity: "1", minimum_stock: "2", reorder_level: null }),
      ),
    ).toBe(true);
  });

  it("prefers reorder_level over minimum_stock", () => {
    // reorder_level (10) wins even though minimum_stock (1) would pass.
    expect(
      isLowStock(
        inventoryRecord({ quantity: "5", minimum_stock: "1", reorder_level: "10" }),
      ),
    ).toBe(true);
  });

  it("compares numerically despite string-serialized decimals", () => {
    expect(
      isLowStock(inventoryRecord({ quantity: "10", reorder_level: "9" })),
    ).toBe(false);
  });
});
