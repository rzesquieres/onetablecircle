import { describe, expect, it } from "vitest";
import { acceptsOrders, billIsPaid, canEditItem, canRemoveItem, editChangesItem, editProblem, isActive } from "./session-rules";

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

describe("canEditItem (OTC-27)", () => {
  it("follows the same rule as removing: orderer or host, until someone pays", () => {
    const me = { id: "ana", isHost: false };
    expect(canEditItem({ status: "closed" }, [], "ana", me)).toBe(true);
    expect(canEditItem({ status: "open" }, [], "ben", me)).toBe(false);
    expect(canEditItem({ status: "open" }, [], "ben", { id: "host", isHost: true })).toBe(true);
    expect(canEditItem({ status: "billing" }, [{ marked_paid_at: "2026-11-15T01:00:00Z" }], "ana", me)).toBe(false);
    expect(canEditItem({ status: "settled" }, [], "ana", me)).toBe(false);
  });
});

describe("editChangesItem (OTC-27)", () => {
  const item = { quantity: 1, notes: "", is_shared: false };
  it("is false when nothing changed, whatever the order of people", () => {
    expect(editChangesItem(item, ["ana"], { quantity: 1, notes: "  ", isShared: false, forIds: ["ana"] })).toBe(false);
    const shared = { ...item, is_shared: true };
    expect(editChangesItem(shared, ["ana", "ben"], { quantity: 1, notes: "", isShared: true, forIds: ["ben", "ana"] })).toBe(false);
  });
  it("is true when sharing, people, quantity or the note changes", () => {
    expect(editChangesItem(item, ["ana"], { quantity: 1, notes: "", isShared: true, forIds: ["ana"] })).toBe(true);
    expect(editChangesItem(item, ["ana"], { quantity: 1, notes: "", isShared: false, forIds: ["ben"] })).toBe(true);
    expect(editChangesItem(item, ["ana"], { quantity: 2, notes: "", isShared: false, forIds: ["ana"] })).toBe(true);
    expect(editChangesItem(item, ["ana"], { quantity: 1, notes: "less ice", isShared: false, forIds: ["ana"] })).toBe(true);
  });
});

describe("editProblem (OTC-27)", () => {
  it("needs someone, exactly one person if not shared, and a sensible quantity", () => {
    expect(editProblem({ quantity: 1, notes: "", isShared: true, forIds: ["ana", "ben"] })).toBeNull();
    expect(editProblem({ quantity: 1, notes: "", isShared: true, forIds: [] })).toMatch(/Choose who/);
    expect(editProblem({ quantity: 1, notes: "", isShared: false, forIds: ["ana", "ben"] })).toMatch(/exactly one/);
    expect(editProblem({ quantity: 0, notes: "", isShared: false, forIds: ["ana"] })).toMatch(/between 1 and 99/);
  });
});
