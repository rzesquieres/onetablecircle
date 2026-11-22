import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-33: covering someone's share ("libre") and celebrant mode.
const HOST = "00000000-0000-0000-0000-0000000033a1";
const ANA = "00000000-0000-0000-0000-0000000033b2";
const BEN = { id: "00000000-0000-0000-0000-0000000033c3", anonymous: true };
const CARL = "00000000-0000-0000-0000-0000000033e5";
const STRANGER = "00000000-0000-0000-0000-0000000033d4";

let db: PGlite;
let sessionId: string;
let receiptId: string;
const pid: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
type Actor = string | typeof BEN;
const cover = (actor: Actor, who: string[], payer: string | null) =>
  as(db, actor, () => db.query("select public.set_covered_by($1, $2)", [who, payer]));
const celebrate = (actor: Actor, who: string, on: boolean) =>
  as(db, actor, () => db.query("select public.set_celebrant($1, $2)", [who, on]));
const state = async (who: string) =>
  one<{ covered_by: string | null; is_celebrant: boolean }>("select covered_by, is_celebrant from public.participants where id = $1", [who]);
const status = async () => (await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status;

const row = (p: string, items: number, covered = 0, covering = 0) => ({
  participant_id: p,
  items_centavos: items,
  service_centavos: 0,
  tax_centavos: 0,
  discount_centavos: 0,
  tip_centavos: 0,
  covered_centavos: covered,
  covering_centavos: covering,
  total_centavos: items - covered + covering,
  breakdown: [],
  adjustments: [],
});
const finalize = (shares: unknown[]) =>
  as(db, HOST, () => db.query("select public.finalize_bill($1, $2)", [sessionId, JSON.stringify(shares)]));

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, email) values ($1, 'h@x'), ($2, 'a@x'), ($3, null), ($4, 's@x'), ($5, 'c@x')", [
    HOST,
    ANA,
    BEN.id,
    STRANGER,
    CARL,
  ]);
  const s = await as(db, HOST, () =>
    one<{ id: string; join_code: string }>("insert into public.sessions (host_id, title) values ($1, 'Birthday') returning id, join_code", [HOST]),
  );
  sessionId = s.id;
  await as(db, ANA, () => db.query("select public.join_session($1, 'Ana')", [s.join_code]));
  await as(db, BEN, () => db.query("select public.join_session($1, 'Ben')", [s.join_code]));
  await as(db, CARL, () => db.query("select public.join_session($1, 'Carl')", [s.join_code]));
  const ps = await db.query<{ id: string; user_id: string }>("select id, user_id from public.participants where session_id = $1", [sessionId]);
  for (const [k, u] of [["host", HOST], ["ana", ANA], ["ben", BEN.id], ["carl", CARL]] as const) pid[k] = ps.rows.find((r) => r.user_id === u)!.id;
  receiptId = await as(db, HOST, async () => {
    const r = await one<{ id: string }>("insert into public.receipts (session_id) values ($1) returning id", [sessionId]);
    await db.query(
      "insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos, split) values ($1, $2, 'FEAST', 40000, 'everyone')",
      [r.id, sessionId],
    );
    return r.id;
  });
}, 60_000);

describe("covering someone", () => {
  it("you can offer to cover others, and cancel your own offer", async () => {
    await cover(ANA, [pid.ben, pid.carl], pid.ana);
    expect((await state(pid.ben)).covered_by).toBe(pid.ana);
    await cover(ANA, [pid.carl], null);
    expect((await state(pid.carl)).covered_by).toBeNull();
  });

  it("you can't volunteer someone else, or take over someone else's offer; the host can", async () => {
    await expect(cover(BEN, [pid.carl], pid.ana)).rejects.toThrow(/only offer to cover people yourself/);
    await expect(cover(CARL, [pid.ben], pid.carl)).rejects.toThrow(/already covered by someone else/);
    await expect(cover(CARL, [pid.ben], null)).rejects.toThrow(/already covered by someone else/);
    await expect(cover(STRANGER, [pid.ben], null)).rejects.toThrow(/not part of this table/);
    await cover(HOST, [pid.ben], pid.carl);
    expect((await state(pid.ben)).covered_by).toBe(pid.carl);
  });

  it("no covering yourself, and no loops", async () => {
    await expect(cover(ANA, [pid.ana], pid.ana)).rejects.toThrow(/can't cover themselves/);
    // Ben is covered by Carl; Ben can't then cover Carl.
    await expect(cover(BEN, [pid.carl], pid.ben)).rejects.toThrow(/loop/);
    await expect(as(db, ANA, () => db.query("update public.participants set covered_by = null where id = $1", [pid.ben]))).rejects.toThrow(
      /permission denied/,
    );
    await cover(HOST, [pid.ben], null);
  });
});

describe("celebrant", () => {
  it("only the host chooses", async () => {
    await expect(celebrate(ANA, pid.carl, true)).rejects.toThrow(/Only the table's creator/);
    await celebrate(HOST, pid.carl, true);
    expect((await state(pid.carl)).is_celebrant).toBe(true);
  });

  it("the celebrant can't be covered or cover others", async () => {
    await expect(cover(ANA, [pid.carl], pid.ana)).rejects.toThrow(/is the celebrant/);
    await expect(cover(HOST, [pid.ben], pid.carl)).rejects.toThrow(/celebrant can't cover/);
    await celebrate(HOST, pid.carl, false);
    await cover(CARL, [pid.ben], pid.carl);
    await expect(celebrate(HOST, pid.carl, true)).rejects.toThrow(/covering others/);
    await cover(CARL, [pid.ben], null);
  });
});

describe("sending the bill", () => {
  it("treats must balance and only go to people who are covered", async () => {
    await cover(ANA, [pid.ben], pid.ana);
    // 400.00 split 4 ways; Ana covers Ben.
    await expect(finalize([row(pid.host, 10000), row(pid.ana, 10000, 0, 10000), row(pid.ben, 10000), row(pid.carl, 10000, 10000)])).rejects.toThrow(
      /Only people who are covered or celebrating/,
    );
    await expect(finalize([row(pid.host, 10000), row(pid.ana, 10000, 0, 9000), row(pid.ben, 10000, 10000), row(pid.carl, 10000)])).rejects.toThrow(
      /don't add up/,
    );
    await finalize([row(pid.host, 10000), row(pid.ana, 10000, 0, 10000), row(pid.ben, 10000, 10000), row(pid.carl, 10000)]);
    const ben = await one<{ total_centavos: string }>("select total_centavos from public.bill_shares where participant_id = $1", [pid.ben]);
    expect(Number(ben.total_centavos)).toBe(0);
    void receiptId;
  });

  it("a change after sending takes the bill back; after a payment it's locked", async () => {
    await cover(ANA, [pid.ben], null);
    expect(await status()).toBe("closed");
    await as(db, HOST, () => db.query("update public.sessions set status = 'open' where id = $1", [sessionId]));
    await finalize([pid.host, pid.ana, pid.ben, pid.carl].map((p) => row(p, 10000)));
    await as(db, ANA, () => db.query("select public.mark_paid($1, $2, true)", [sessionId, pid.ana]));
    await expect(cover(ANA, [pid.ben], pid.ana)).rejects.toThrow(/bill has been paid/);
    await expect(celebrate(HOST, pid.carl, true)).rejects.toThrow(/bill has been paid/);
  });
});
