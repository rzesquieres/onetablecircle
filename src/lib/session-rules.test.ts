import { describe, expect, it } from "vitest";
import { acceptsOrders, billIsPaid, canRemoveItem, isActive } from "./session-rules";

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

describe("canRemoveItem (OTC-25)", () => {
  const ana = { id: "ana", isHost: false };
  const host = { id: "host", isHost: true };
  const ben = { id: "ben", isHost: false };
  const unpaid = [{ marked_paid_at: null }];
  const paid = [{ marked_paid_at: "2026-11-15T01:00:00Z" }];

  it("lets the person who ordered and the host remove, nobody else", () => {
    expect(canRemoveItem({ status: "open" }, [], "ana", ana)).toBe(true);
    expect(canRemoveItem({ status: "open" }, [], "ana", host)).toBe(true);
    expect(canRemoveItem({ status: "open" }, [], "ana", ben)).toBe(false);
  });

  it("still allows it after ordering closes and after the bill is sent, until someone pays", () => {
    expect(canRemoveItem({ status: "closed" }, [], "ana", ana)).toBe(true);
    expect(canRemoveItem({ status: "billing" }, unpaid, "ana", ana)).toBe(true);
    expect(canRemoveItem({ status: "billing" }, paid, "ana", ana)).toBe(false);
    expect(canRemoveItem({ status: "billing" }, paid, "ana", host)).toBe(false);
    expect(canRemoveItem({ status: "settled" }, [], "ana", host)).toBe(false);
  });

  it("billIsPaid matches the database", () => {
    expect(billIsPaid({ status: "billing" }, [])).toBe(false);
    expect(billIsPaid({ status: "billing" }, paid)).toBe(true);
    expect(billIsPaid({ status: "settled" }, [])).toBe(true);
  });
});
