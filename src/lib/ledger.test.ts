import { describe, expect, it } from "vitest";
import { computeLedger, simplify, type LedgerMember, type LedgerTable } from "./ledger";

const members: LedgerMember[] = [
  { id: "ana", name: "Ana" },
  { id: "ben", name: "Ben" },
  { id: "cat", name: "Cat" },
];
const table = (id: string, host: string | null, shares: [string, number, boolean?][], date = `2026-11-0${id.slice(-1)}T12:00:00Z`): LedgerTable => ({
  sessionId: id,
  title: `Table ${id}`,
  date,
  hostMemberId: host,
  shares: shares.map(([memberId, total, paid]) => ({ memberId, total, paid: Boolean(paid) })),
});
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("computeLedger", () => {
  it("unpaid shares become debts to the host; paid ones don't", () => {
    const l = computeLedger(members, [table("t1", "ana", [["ana", 30000], ["ben", 34000], ["cat", 20000, true]])], []);
    expect(l.balances).toEqual({ ana: 34000, ben: -34000, cat: 0 });
    expect(l.pairs).toEqual([{ from: "ben", to: "ana", amount: 34000 }]);
    expect(l.history.ben).toEqual([{ kind: "meal", date: "2026-11-01T12:00:00Z", title: "Table t1", amount: -34000, sessionId: "t1" }]);
  });

  it("nets across meals hosted by different people", () => {
    const l = computeLedger(
      members,
      [table("t1", "ana", [["ben", 50000], ["cat", 10000]]), table("t2", "ben", [["ana", 20000], ["cat", 30000]])],
      [],
    );
    // Ben owes Ana 500, Ana owes Ben 200 -> Ben owes Ana 300 net.
    expect(l.pairs).toEqual([
      { from: "ben", to: "ana", amount: 30000 },
      { from: "cat", to: "ana", amount: 10000 },
      { from: "cat", to: "ben", amount: 30000 },
    ]);
    expect(l.balances).toEqual({ ana: 40000, ben: 0, cat: -40000 });
    expect(sum(l.balances)).toBe(0);
    // Simplified: Cat pays Ana 400 and everyone is square.
    expect(l.simplified).toEqual([{ from: "cat", to: "ana", amount: 40000 }]);
    expect(l.history.ana.map((h) => h.sessionId)).toEqual(["t2", "t1"]); // newest first
  });

  it("settle-ups cancel debts", () => {
    const l = computeLedger(members, [table("t1", "ana", [["ben", 34000]])], [
      { id: "s1", fromMemberId: "ben", toMemberId: "ana", amount: 20000, createdAt: "2026-11-05T00:00:00Z", note: "GCash" },
    ]);
    expect(l.balances).toEqual({ ana: 14000, ben: -14000, cat: 0 });
    expect(l.pairs).toEqual([{ from: "ben", to: "ana", amount: 14000 }]);
    expect(l.history.ben[0]).toEqual({ kind: "settle", date: "2026-11-05T00:00:00Z", title: "GCash", amount: 20000, settlementId: "s1" });
  });

  it("leaves out hosts and people who aren't in the Circle", () => {
    const l = computeLedger(
      members,
      [table("t1", null, [["ben", 10000]]), table("t2", "ana", [["stranger", 10000], ["cat", 5000]])],
      [{ id: "x", fromMemberId: "stranger", toMemberId: "ana", amount: 100, createdAt: "", note: "" }],
    );
    expect(l.balances).toEqual({ ana: 5000, ben: 0, cat: -5000 });
  });
});

describe("simplify", () => {
  it("uses at most n - 1 transfers and adds up", () => {
    const t = simplify({ a: 60000, b: -10000, c: -20000, d: -30000 });
    expect(t).toEqual([
      { from: "d", to: "a", amount: 30000 },
      { from: "c", to: "a", amount: 20000 },
      { from: "b", to: "a", amount: 10000 },
    ]);
    expect(simplify({ a: 0, b: 0 })).toEqual([]);
  });

  it("splits one debt across creditors when needed", () => {
    expect(simplify({ a: 10000, b: 5000, c: -15000 })).toEqual([
      { from: "c", to: "a", amount: 10000 },
      { from: "c", to: "b", amount: 5000 },
    ]);
  });
});
