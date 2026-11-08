import { describe, expect, it } from "vitest";
import { acceptsOrders, isActive } from "./session-rules";

const now = new Date("2026-11-08T12:00:00Z");

describe("acceptsOrders", () => {
  it("is true while open with no cutoff or a future cutoff", () => {
    expect(acceptsOrders({ status: "open", order_cutoff_at: null }, now)).toBe(true);
    expect(acceptsOrders({ status: "open", order_cutoff_at: "2026-11-08T12:05:00Z" }, now)).toBe(true);
  });
  it("is false after the cutoff or when not open", () => {
    expect(acceptsOrders({ status: "open", order_cutoff_at: "2026-11-08T11:59:00Z" }, now)).toBe(false);
    expect(acceptsOrders({ status: "closed", order_cutoff_at: null }, now)).toBe(false);
  });
});

describe("isActive", () => {
  it("allows ticking while open or closed, not once billing starts", () => {
    expect(isActive({ status: "open" })).toBe(true);
    expect(isActive({ status: "closed" })).toBe(true);
    expect(isActive({ status: "billing" })).toBe(false);
  });
});
