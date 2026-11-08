import { describe, expect, it } from "vitest";
import {
  consolidate,
  groupKey,
  itemsFor,
  pickItemForTick,
  progress,
  servedCounts,
} from "./consolidate";
import type { Assignee, DeliveryEvent, OrderItem } from "./types";

let seq = 0;
function item(p: Partial<OrderItem> & { id: string }): OrderItem {
  seq += 1;
  return {
    session_id: "s",
    added_by: "pA",
    name: "Iced latte",
    unit_price_centavos: 18000,
    quantity: 1,
    notes: "",
    is_shared: false,
    created_at: `2026-11-08T10:00:${String(seq).padStart(2, "0")}Z`,
    ...p,
  };
}
const assign = (order_item_id: string, participant_id: string): Assignee => ({
  order_item_id,
  participant_id,
  session_id: "s",
  share_weight: 1,
});
let eid = 0;
const ev = (order_item_id: string, delta: 1 | -1): DeliveryEvent => ({
  id: ++eid,
  order_item_id,
  session_id: "s",
  delta,
  by_participant_id: "pA",
  created_at: "2026-11-08T11:00:00Z",
});

describe("groupKey", () => {
  it("ignores case and extra spaces, but respects notes and price", () => {
    expect(groupKey({ name: " Iced  Latte", notes: "Oat", unit_price_centavos: 18000 })).toBe(
      groupKey({ name: "iced latte", notes: "oat ", unit_price_centavos: 18000 }),
    );
    expect(groupKey({ name: "Iced latte", notes: "", unit_price_centavos: 18000 })).not.toBe(
      groupKey({ name: "Iced latte", notes: "oat", unit_price_centavos: 18000 }),
    );
    expect(groupKey({ name: "Iced latte", notes: "", unit_price_centavos: null })).not.toBe(
      groupKey({ name: "Iced latte", notes: "", unit_price_centavos: 18000 }),
    );
  });
});

describe("consolidate", () => {
  const a = item({ id: "a", quantity: 2 });
  const b = item({ id: "b", name: "iced LATTE", added_by: "pB" });
  const c = item({ id: "c", name: "Nachos", unit_price_centavos: 45000, is_shared: true });
  const items = [c, b, a]; // deliberately out of order
  const assignees = [assign("a", "pA"), assign("b", "pB"), assign("c", "pA"), assign("c", "pB")];

  it("groups identical items and sums quantities, keeping first-ordered order", () => {
    const lines = consolidate(items, assignees, []);
    expect(lines.map((l) => [l.name, l.quantity])).toEqual([
      ["Iced latte", 3],
      ["Nachos", 1],
    ]);
    expect(lines[0].participantIds).toEqual(["pA", "pB"]);
    expect(lines[1].isShared).toBe(true);
  });

  it("tracks partial delivery and overall progress", () => {
    const lines = consolidate(items, assignees, [ev("a", 1), ev("a", 1), ev("a", -1), ev("c", 1)]);
    expect(lines[0].served).toBe(1);
    expect(progress(lines)).toEqual({ served: 2, total: 4 });
  });
});

describe("servedCounts", () => {
  it("clamps to 0..quantity even if events are inconsistent", () => {
    const a = item({ id: "a", quantity: 1 });
    const s = servedCounts([a], [ev("a", 1), ev("a", 1)]);
    expect(s.get("a")).toBe(1);
    expect(servedCounts([a], [ev("a", -1)]).get("a")).toBe(0);
  });
});

describe("pickItemForTick", () => {
  const first = item({ id: "first", quantity: 2 });
  const second = item({ id: "second", quantity: 1 });
  const [line] = consolidate([second, first], [], []);

  it("serves the oldest unserved item first", () => {
    expect(pickItemForTick(line, new Map(), 1)).toBe("first");
    expect(pickItemForTick(line, new Map([["first", 2]]), 1)).toBe("second");
    expect(pickItemForTick(line, new Map([["first", 2], ["second", 1]]), 1)).toBeNull();
  });

  it("unticks the newest served item first", () => {
    expect(pickItemForTick(line, new Map([["first", 2], ["second", 1]]), -1)).toBe("second");
    expect(pickItemForTick(line, new Map([["first", 1]]), -1)).toBe("first");
    expect(pickItemForTick(line, new Map(), -1)).toBeNull();
  });
});

describe("itemsFor", () => {
  it("lists a person's own and shared items with served status", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b", name: "Cake" });
    const c = item({ id: "c", name: "Nachos", is_shared: true });
    const mine = itemsFor(
      "pA",
      [a, b, c],
      [assign("a", "pA"), assign("b", "pB"), assign("c", "pA"), assign("c", "pB")],
      [ev("a", 1)],
    );
    expect(mine.map((m) => [m.item.id, m.served, m.sharedWith])).toEqual([
      ["a", 1, 1],
      ["c", 0, 2],
    ]);
  });
});
