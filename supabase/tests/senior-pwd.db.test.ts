import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-31: Senior/PWD discount only for people marked Senior or PWD.
const HOST = "00000000-0000-0000-0000-0000000031a1";
const LOLA = "00000000-0000-0000-0000-0000000031b2";
const BEN = { id: "00000000-0000-0000-0000-0000000031c3", anonymous: true };
const STRANGER = "00000000-0000-0000-0000-0000000031d4";

let db: PGlite;
let sessionId: string;
let receiptId: string;
const pid: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

const mark = (actor: string | typeof BEN, who: string, kind: "senior" | "pwd" | null) =>
  as(db, actor, () => db.query("select public.set_sc_pwd($1, $2)", [who, kind]));
const kindOf = async (who: string) => (await one<{ sc_pwd: string | null }>("select sc_pwd from public.participants where id = $1", [who])).sc_pwd;
const status = async () => (await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status;

/** A share row; Lola ate 112.00, Ben 100.00. */
const row = (p: string, items: number, sc = 0) => ({
  participant_id: p,
  items_centavos: items,
  service_centavos: 0,
  tax_centavos: 0,
  discount_centavos: 0,
  sc_pwd_discount_centavos: sc,
  tip_centavos: 0,
  total_centavos: items - sc,
  breakdown: [],
});
const finalize = (shares: unknown[]) =>
  as(db, HOST, () => db.query("select public.finalize_bill($1, $2)", [sessionId, JSON.stringify(shares)]));

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, email) values ($1, 'h@x'), ($2, 'l@x'), ($3, null), ($4, 's@x')", [
    HOST,
    LOLA,
    BEN.id,
    STRANGER,
  ]);
  const s = await as(db, HOST, () =>
    one<{ id: string; join_code: string }>("insert into public.sessions (host_id, title) values ($1, 'Sunday lunch') returning id, join_code", [HOST]),
  );
  sessionId = s.id;
  await as(db, LOLA, () => db.query("select public.join_session($1, 'Lola')", [s.join_code]));
  await as(db, BEN, () => db.query("select public.join_session($1, 'Ben')", [s.join_code]));
  const ps = await db.query<{ id: string; user_id: string }>("select id, user_id from public.participants where session_id = $1", [sessionId]);
  pid.host = ps.rows.find((r) => r.user_id === HOST)!.id;
  pid.lola = ps.rows.find((r) => r.user_id === LOLA)!.id;
  pid.ben = ps.rows.find((r) => r.user_id === BEN.id)!.id;
  pid.tito = await as(db, BEN, () =>
    one<{ id: string }>("select public.add_offline_person($1, 'Tito') as id", [sessionId]).then((r) => r.id),
  );

  await as(db, HOST, async () => {
    const r = await one<{ id: string }>("insert into public.receipts (session_id) values ($1) returning id", [sessionId]);
    receiptId = r.id;
    await db.query(
      "insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos, split) values ($1, $2, 'PANCIT', 21200, 'everyone')",
      [r.id, sessionId],
    );
  });
}, 60_000);

describe("marking someone Senior or PWD", () => {
  it("the person themselves, the host, or whoever added them", async () => {
    await mark(LOLA, pid.lola, "senior");
    expect(await kindOf(pid.lola)).toBe("senior");
    await mark(HOST, pid.ben, "pwd");
    expect(await kindOf(pid.ben)).toBe("pwd");
    await mark(BEN, pid.tito, "senior");
    expect(await kindOf(pid.tito)).toBe("senior");
    await mark(BEN, pid.tito, null);
    expect(await kindOf(pid.tito)).toBeNull();
  });

  it("not someone else at the table, and not a stranger", async () => {
    await expect(mark(LOLA, pid.ben, null)).rejects.toThrow(/Only the table's creator or the person themselves/);
    await expect(mark(STRANGER, pid.lola, null)).rejects.toThrow(/not part of this table/);
    await expect(mark(LOLA, pid.lola, "vip" as "pwd")).rejects.toThrow(/Senior or PWD/);
    await expect(as(db, LOLA, () => db.query("update public.participants set sc_pwd = null where id = $1", [pid.lola]))).rejects.toThrow(
      /permission denied/,
    );
    expect(await kindOf(pid.lola)).toBe("senior");
  });
});

describe("sending the bill", () => {
  it("the Senior/PWD discount must add up to the receipt and go only to cardholders", async () => {
    await mark(HOST, pid.ben, null);
    await as(db, HOST, () => db.query("update public.receipts set sc_pwd_discount_centavos = 3200 where id = $1", [receiptId]));

    // Given to Ben, who isn't marked.
    await expect(finalize([row(pid.host, 5300), row(pid.lola, 5300), row(pid.ben, 5300, 3200), row(pid.tito, 5300)])).rejects.toThrow(
      /only go to people marked Senior or PWD/,
    );
    // Doesn't add up.
    await expect(finalize([row(pid.host, 5300), row(pid.lola, 5300, 3000), row(pid.ben, 5300), row(pid.tito, 5300)])).rejects.toThrow(
      /don't add up/,
    );
    // A share whose total ignores the discount.
    await expect(
      finalize([row(pid.host, 5300), { ...row(pid.lola, 5300, 3200), total_centavos: 5300 }, row(pid.ben, 5300), row(pid.tito, 5300)]),
    ).rejects.toThrow(/bill_shares_total_adds_up/);

    await finalize([row(pid.host, 5300), row(pid.lola, 5300, 3200), row(pid.ben, 5300), row(pid.tito, 5300)]);
    expect(await status()).toBe("billing");
    const lola = await one<{ sc_pwd_discount_centavos: string; total_centavos: string }>(
      "select sc_pwd_discount_centavos, total_centavos from public.bill_shares where participant_id = $1",
      [pid.lola],
    );
    expect(Number(lola.sc_pwd_discount_centavos)).toBe(3200);
    expect(Number(lola.total_centavos)).toBe(2100);
  });

  it("older clients without the new field still work when there's no Senior/PWD discount", async () => {
    await as(db, HOST, () => db.query("select public.reopen_bill($1)", [sessionId]));
    await as(db, HOST, () => db.query("update public.receipts set sc_pwd_discount_centavos = 0 where id = $1", [receiptId]));
    const old = [pid.host, pid.lola, pid.ben, pid.tito].map((p) => {
      const { sc_pwd_discount_centavos: _drop, ...rest } = row(p, 5300);
      void _drop;
      return rest;
    });
    await finalize(old);
    expect(await status()).toBe("billing");
  });

  it("changing who's marked after the bill is sent takes it back; after a payment, it can't change", async () => {
    await mark(LOLA, pid.lola, "pwd");
    expect(await status()).toBe("closed");
    expect((await db.query("select 1 from public.bill_shares where session_id = $1", [sessionId])).rows).toHaveLength(0);

    await as(db, HOST, () => db.query("update public.sessions set status = 'open' where id = $1", [sessionId]));
    await finalize([pid.host, pid.lola, pid.ben, pid.tito].map((p) => row(p, 5300)));
    await as(db, LOLA, () => db.query("select public.mark_paid($1, $2, true)", [sessionId, pid.lola]));
    await expect(mark(LOLA, pid.lola, null)).rejects.toThrow(/bill has been paid/);
    // Once paid, even re-marking the same thing is refused.
    await expect(mark(LOLA, pid.lola, "pwd")).rejects.toThrow(/bill has been paid/);
  });
});
