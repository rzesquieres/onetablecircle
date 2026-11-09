import { describe, expect, it } from "vitest";
import { allocate, computeBill, similarity, suggestMatches, type BillInput, type BillLine } from "./bill";

describe("allocate", () => {
  it("always adds up exactly", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(7, [2, 1])).toEqual([5, 2]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
  });

  it("gives leftover centavos to the largest remainders, ties to the earliest", () => {
    // 10 split 1:1:1:1 -> 2.5 each: the first two get the extra centavo
    expect(allocate(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
    // 5 split 1:3 -> 1.25 / 3.75: the larger remainder (0.75) gets the extra centavo
    expect(allocate(5, [1, 3])).toEqual([1, 4]);
  });

  it("splits equally when every weight is zero", () => {
    expect(allocate(3, [0, 0])).toEqual([2, 1]);
  });

  it("handles big amounts without float errors", () => {
    const parts = allocate(999_999_999, [123_456_789, 987_654_321, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(999_999_999);
  });

  it("rejects bad input", () => {
    expect(() => allocate(1.5, [1])).toThrow();
    expect(() => allocate(-1, [1])).toThrow();
    expect(() => allocate(5, [])).toThrow();
  });
});

const P = (id: string, t: number) => ({ id, joined_at: `2026-11-10T10:00:0${t}Z` });
const people = [P("host", 0), P("ana", 1), P("ben", 2)];
const items = [
  { id: "latte", quantity: 1, created_at: "2026-11-10T10:01:00Z", added_by: "ana" },
  { id: "nachos", quantity: 1, created_at: "2026-11-10T10:02:00Z", added_by: "host" },
  { id: "beer", quantity: 2, created_at: "2026-11-10T10:03:00Z", added_by: "ben" },
  { id: "beer2", quantity: 1, created_at: "2026-11-10T10:04:00Z", added_by: "host" },
];
const assignees = [
  { order_item_id: "latte", participant_id: "ana", share_weight: 1 },
  { order_item_id: "nachos", participant_id: "host", share_weight: 1 },
  { order_item_id: "nachos", participant_id: "ana", share_weight: 1 },
  { order_item_id: "nachos", participant_id: "ben", share_weight: 1 },
  { order_item_id: "beer", participant_id: "ben", share_weight: 1 },
  { order_item_id: "beer2", participant_id: "host", share_weight: 1 },
];
const line = (id: string, amount: number, p: Partial<BillLine> = {}): BillLine => ({
  id,
  description: id.toUpperCase(),
  amount,
  split: "items",
  itemIds: [],
  people: [],
  ...p,
});
const base: BillInput = { participants: people, items, assignees, lines: [], charges: { service: 0, tax: 0, discount: 0, tip: 0 } };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("computeBill", () => {
  it("splits matched items, shared items and charges; totals equal the receipt", () => {
    const r = computeBill({
      ...base,
      lines: [
        line("latte", 20000, { itemIds: ["latte"] }),
        line("nachos", 30001, { itemIds: ["nachos"] }), // odd centavo
        line("beer", 27000, { itemIds: ["beer", "beer2"] }), // 3 beers on one line: by quantity 2:1
      ],
      charges: { service: 7700, tax: 0, discount: 1000, tip: 500 },
    });
    expect(r.problems).toEqual([]);
    const by = Object.fromEntries(r.shares.map((s) => [s.participantId, s]));
    expect(by.ana.items).toBe(20000 + 10000); // latte + 1/3 nachos
    expect(by.host.items).toBe(10001 + 9000); // 1/3 nachos (+ leftover centavo, joined first) + 1 beer
    expect(by.ben.items).toBe(10000 + 18000);
    expect(r.itemsTotal).toBe(77001);
    expect(sum(r.shares.map((s) => s.items))).toBe(77001);
    expect(sum(r.shares.map((s) => s.service))).toBe(7700);
    expect(sum(r.shares.map((s) => s.discount))).toBe(1000);
    expect(sum(r.shares.map((s) => s.total))).toBe(r.total);
    expect(r.total).toBe(77001 + 7700 + 500 - 1000);
    for (const s of r.shares) expect(s.total).toBe(s.items + s.service + s.tax + s.tip - s.discount);
    expect(by.ana.breakdown.map((b) => [b.description, b.amount, b.note])).toEqual([
      ["LATTE", 20000, ""],
      ["NACHOS", 10000, "shared by 3"],
    ]);
  });

  it("supports lines for chosen people (weighted) and for everyone", () => {
    const r = computeBill({
      ...base,
      lines: [
        line("corkage", 50000, { split: "people", people: [{ participantId: "ana", weight: 1 }, { participantId: "ben", weight: 3 }] }),
        line("rice", 10000, { split: "everyone" }),
      ],
    });
    const by = Object.fromEntries(r.shares.map((s) => [s.participantId, s.items]));
    expect(by).toEqual({ host: 3334, ana: 12500 + 3333, ben: 37500 + 3333 });
  });

  it("reports lines nobody pays for and over-sized discounts", () => {
    const r = computeBill({
      ...base,
      lines: [line("mystery", 1000), line("pp", 500, { split: "people" })],
      charges: { service: 0, tax: 0, discount: 999999, tip: 0 },
    });
    expect(r.problems).toEqual([
      'Match "MYSTERY" to an ordered item, or choose who pays',
      'Choose who pays for "PP"',
      "The discount is bigger than the bill",
      "A discount is bigger than someone's share",
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const lines = [line("nachos", 10000, { itemIds: ["nachos"] }), line("latte", 333, { itemIds: ["latte"] })];
    const a = computeBill({ ...base, lines, charges: { service: 1001, tax: 0, discount: 0, tip: 0 } });
    const b = computeBill({
      ...base,
      participants: [...people].reverse(),
      assignees: [...assignees].reverse(),
      lines,
      charges: { service: 1001, tax: 0, discount: 0, tip: 0 },
    });
    expect(b.shares).toEqual(a.shares);
  });
});

describe("matching", () => {
  it("scores receipt-style names", () => {
    expect(similarity("ICED LATTE GRANDE", "Iced latte")).toBe(1);
    expect(similarity("CHKN ADOBO", "Pork adobo")).toBe(0.5);
    expect(similarity("CHKN ADOBO", "Chicken adobo")).toBe(1);
    expect(similarity("NACHOS PLTR", "Nachos platter")).toBe(1);
    expect(similarity("", "x")).toBe(0);
  });

  it("matches lines to items, each item once, up to the line's quantity", () => {
    const orderItems = [
      { id: "l1", name: "Iced latte", quantity: 1, options: [{ group: "Size", option: "Grande", price_delta_centavos: 0 }], created_at: "1" },
      { id: "l2", name: "Iced Latte", quantity: 1, options: [], created_at: "2" },
      { id: "n", name: "Nachos platter", quantity: 1, options: [], created_at: "3" },
      { id: "c", name: "Cake", quantity: 1, options: [], created_at: "4" },
    ];
    const m = suggestMatches(
      [
        { description: "2 ICED LATTE", quantity: 2 },
        { description: "NACHOS PLTR", quantity: 1 },
        { description: "SVC CHARGE", quantity: 1 },
      ],
      orderItems,
    );
    expect(m).toEqual([["l1", "l2"], ["n"], []]);
  });
});
