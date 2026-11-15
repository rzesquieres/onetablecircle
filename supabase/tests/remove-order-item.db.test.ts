import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-25: the person who ordered, or the table's creator, can remove an order
// until the bill is paid. The creator removing someone else's order notifies them.
const HOST = "00000000-0000-0000-0000-0000000025a1";
const ANA = "00000000-0000-0000-0000-0000000025b2";
const BEN = { id: "00000000-0000-0000-0000-0000000025c3", anonymous: true };
const STRANGER = "00000000-0000-0000-0000-0000000025d4";

let db: PGlite;
let sessionId: string;
const pid: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

const addItem = (actor: string | typeof BEN, name: string, qty: number, forPid: string) =>
  as(db, actor, () =>
    one<{ id: string }>("select public.add_order_item($1, $2, 10000, $3, '', false, $4) as id", [sessionId, name, qty, [forPid]]),
  ).then((r) => r.id);

const remove = (actor: string | typeof BEN, itemId: string) =>
  as(db, actor, () => db.query("select public.remove_order_item($1)", [itemId]));

const exists = async (itemId: string) =>
  (await db.query("select 1 from public.order_items where id = $1", [itemId])).rows.length === 1;

const notificationsFor = (userId: string) =>
  db.query<{ body: string; kind: string }>("select kind, body from public.notifications where user_id = $1 order by created_at", [userId]).then(
    (r) => r.rows,
  );

const setStatus = (status: string) =>
  as(db, HOST, () => db.query("update public.sessions set status = $2 where id = $1", [sessionId, status]));

/** Bill one item (the whole receipt is that item, ₱100, paid by `payer`). */
async function sendBill(itemId: string, payer: string) {
  await as(db, HOST, async () => {
    await db.query("delete from public.receipts where session_id = $1", [sessionId]);
    const r = await one<{ id: string }>("insert into public.receipts (session_id) values ($1) returning id", [sessionId]);
    const l = await one<{ id: string }>(
      "insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos) values ($1, $2, 'ITEM', 10000) returning id",
      [r.id, sessionId],
    );
    await db.query("insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id) values ($1, $2, $3)", [
      l.id,
      itemId,
      sessionId,
    ]);
    const shares = Object.values(pid).map((p) => {
      const amt = p === payer ? 10000 : 0;
      return { participant_id: p, items_centavos: amt, service_centavos: 0, tax_centavos: 0, discount_centavos: 0, tip_centavos: 0, total_centavos: amt, breakdown: [] };
    });
    await db.query("select public.finalize_bill($1, $2)", [sessionId, JSON.stringify(shares)]);
  });
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, email) values ($1, 'h@x'), ($2, 'a@x'), ($3, null), ($4, 's@x')", [
    HOST,
    ANA,
    BEN.id,
    STRANGER,
  ]);
  const s = await as(db, HOST, () =>
    one<{ id: string; join_code: string }>("insert into public.sessions (host_id, title) values ($1, 'Friday dinner') returning id, join_code", [HOST]),
  );
  sessionId = s.id;
  await as(db, ANA, () => db.query("select public.join_session($1, 'Ana')", [s.join_code]));
  await as(db, BEN, () => db.query("select public.join_session($1, 'Ben')", [s.join_code]));
  await as(db, HOST, () => db.query("update public.participants set display_name = 'Ronnel' where is_host"));
  const ps = await db.query<{ id: string; user_id: string }>("select id, user_id from public.participants where session_id = $1", [sessionId]);
  pid.host = ps.rows.find((r) => r.user_id === HOST)!.id;
  pid.ana = ps.rows.find((r) => r.user_id === ANA)!.id;
  pid.ben = ps.rows.find((r) => r.user_id === BEN.id)!.id;
}, 60_000);

describe("who can remove an order", () => {
  it("not someone else at the table, and not a stranger", async () => {
    const latte = await addItem(ANA, "Latte", 1, pid.ana);
    await expect(remove(BEN, latte)).rejects.toThrow(/Only the person who ordered it or the table's creator/);
    await expect(remove(STRANGER, latte)).rejects.toThrow(/not part of this table/);
    expect(await exists(latte)).toBe(true);
  });

  it("nobody can delete rows directly, so the rules can't be skipped", async () => {
    const tea = await addItem(ANA, "Tea", 1, pid.ana);
    await expect(as(db, ANA, () => db.query("delete from public.order_items where id = $1", [tea]))).rejects.toThrow(
      /permission denied/,
    );
    await remove(ANA, tea);
  });

  it("the person who ordered, even after ordering has closed, without a notification", async () => {
    const cake = await addItem(ANA, "Cake", 1, pid.ana);
    await setStatus("closed");
    await remove(ANA, cake);
    expect(await exists(cake)).toBe(false);
    expect(await notificationsFor(ANA)).toEqual([]);
    await setStatus("open");
  });

  it("the host can remove someone else's order, and that person is told in the app", async () => {
    const water = await addItem(BEN, "Water", 2, pid.ben);
    await remove(HOST, water);
    expect(await exists(water)).toBe(false);
    expect(await notificationsFor(BEN.id)).toEqual([
      { kind: "order_removed", body: "Ronnel removed your order: 2× Water from Friday dinner." },
    ]);
    expect(await notificationsFor(ANA)).toEqual([]);
  });

  it("the host removing their own order (even one for someone else) notifies nobody", async () => {
    const rice = await addItem(HOST, "Rice", 1, pid.ben);
    await remove(HOST, rice);
    expect(await notificationsFor(BEN.id)).toHaveLength(1);
    expect(await notificationsFor(HOST)).toEqual([]);
  });

  it("removing an item that's already gone says so", async () => {
    await expect(remove(HOST, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/already removed/);
  });
});

describe("notifications", () => {
  it("are private: only the recipient sees them", async () => {
    expect((await as(db, BEN, () => db.query("select 1 from public.notifications"))).rows).toHaveLength(1);
    expect((await as(db, ANA, () => db.query("select 1 from public.notifications"))).rows).toHaveLength(0);
    expect((await as(db, HOST, () => db.query("select 1 from public.notifications"))).rows).toHaveLength(0);
  });

  it("the recipient can mark one read, but can't change it or write new ones", async () => {
    const r = await as(db, BEN, () => db.query("update public.notifications set read_at = now() returning id"));
    expect(r.rows).toHaveLength(1);
    await expect(as(db, BEN, () => db.query("update public.notifications set body = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, ANA, () =>
        db.query("insert into public.notifications (user_id, kind, body) values ($1, 'order_removed', 'fake')", [BEN.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    const other = await as(db, ANA, () => db.query("update public.notifications set read_at = null returning id"));
    expect(other.rows).toHaveLength(0);
  });
});

describe("until the bill is paid", () => {
  let latte: string;

  it("after the bill is sent but before anyone pays, removing takes the bill back", async () => {
    latte = await addItem(ANA, "Iced latte", 1, pid.ana);
    const extra = await addItem(ANA, "Extra shot", 1, pid.ana);
    await sendBill(latte, pid.ana);
    expect((await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status).toBe("billing");

    await remove(ANA, extra);
    expect(await exists(extra)).toBe(false);
    expect((await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status).toBe("closed");
    expect((await one<{ status: string }>("select status from public.receipts where session_id = $1", [sessionId])).status).toBe("review");
    expect((await db.query("select 1 from public.bill_shares where session_id = $1", [sessionId])).rows).toHaveLength(0);
  });

  it("once anyone has paid, nobody can remove anything", async () => {
    await setStatus("open");
    const cookie = await addItem(HOST, "Cookie", 1, pid.host);
    await sendBill(latte, pid.ana);
    await as(db, ANA, () => db.query("select public.mark_paid($1, $2, true)", [sessionId, pid.ana]));
    await expect(remove(ANA, latte)).rejects.toThrow(/bill has been paid/);
    await expect(remove(HOST, latte)).rejects.toThrow(/bill has been paid/);
    await expect(remove(HOST, cookie)).rejects.toThrow(/bill has been paid/);
    expect(await exists(latte)).toBe(true);
    expect((await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status).toBe("billing");
  });

  it("nor once the table is settled", async () => {
    await as(db, HOST, () => db.query("select public.reopen_bill($1)", [sessionId]));
    await setStatus("settled");
    await expect(remove(HOST, latte)).rejects.toThrow(/bill has been paid/);
  });
});
