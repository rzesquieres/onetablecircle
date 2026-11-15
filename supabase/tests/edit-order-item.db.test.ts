import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-27: the person who ordered, or the table's creator, can change who an
// order is for (shared or not, and by whom), how many, and the note, until the
// bill is paid. The creator changing someone else's order notifies them.
const HOST = "00000000-0000-0000-0000-0000000027a1";
const ANA = "00000000-0000-0000-0000-0000000027b2";
const BEN = { id: "00000000-0000-0000-0000-0000000027c3", anonymous: true };
const STRANGER = "00000000-0000-0000-0000-0000000027d4";

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

const edit = (actor: string | typeof BEN, itemId: string, qty: number, notes: string, shared: boolean, forPids: string[]) =>
  as(db, actor, () => db.query("select public.edit_order_item($1, $2, $3, $4, $5)", [itemId, qty, notes, shared, forPids]));

const itemOf = (itemId: string) =>
  one<{ quantity: number; notes: string; is_shared: boolean }>("select quantity, notes, is_shared from public.order_items where id = $1", [
    itemId,
  ]);

const forOf = async (itemId: string) =>
  (await db.query<{ participant_id: string }>("select participant_id from public.order_item_assignees where order_item_id = $1", [itemId])).rows
    .map((r) => r.participant_id)
    .sort();

const notificationsFor = (userId: string, kind = "order_edited") =>
  db
    .query<{ body: string }>("select body from public.notifications where user_id = $1 and kind = $2 order by created_at", [userId, kind])
    .then((r) => r.rows.map((x) => x.body));

const statusOf = async () => (await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status;

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

describe("what can be changed", () => {
  it("the orderer can make an item shared and pick who shares it", async () => {
    const nachos = await addItem(ANA, "Nachos", 1, pid.ana);
    await edit(ANA, nachos, 1, "", true, [pid.ana, pid.ben]);
    expect((await itemOf(nachos)).is_shared).toBe(true);
    expect(await forOf(nachos)).toEqual([pid.ana, pid.ben].sort());

    // Change who shares it, then make it personal again (for someone else).
    await edit(ANA, nachos, 2, "extra cheese", true, [pid.ana, pid.host, pid.ben]);
    expect(await forOf(nachos)).toEqual([pid.ana, pid.host, pid.ben].sort());
    await edit(ANA, nachos, 2, "extra cheese", false, [pid.ben]);
    expect(await itemOf(nachos)).toEqual({ quantity: 2, notes: "extra cheese", is_shared: false });
    expect(await forOf(nachos)).toEqual([pid.ben]);
    expect(await notificationsFor(ANA)).toEqual([]);
  });

  it("people who stay on a shared item keep their share weight", async () => {
    const platter = await addItem(ANA, "Platter", 1, pid.ana);
    await edit(ANA, platter, 1, "", true, [pid.ana, pid.ben]);
    await db.query("update public.order_item_assignees set share_weight = 2 where order_item_id = $1 and participant_id = $2", [platter, pid.ana]);
    await edit(ANA, platter, 1, "", true, [pid.ana, pid.host]);
    const w = await one<{ share_weight: number }>(
      "select share_weight from public.order_item_assignees where order_item_id = $1 and participant_id = $2",
      [platter, pid.ana],
    );
    expect(w.share_weight).toBe(2);
  });

  it("rejects bad details and leaves the item as it was", async () => {
    const tea = await addItem(ANA, "Tea", 1, pid.ana);
    await expect(edit(ANA, tea, 1, "", true, [])).rejects.toThrow(/Choose who this is for/);
    await expect(edit(ANA, tea, 1, "", false, [pid.ana, pid.ben])).rejects.toThrow(/exactly one person/);
    await expect(edit(ANA, tea, 0, "", false, [pid.ana])).rejects.toThrow(/between 1 and 99/);
    const other = await as(db, STRANGER, () =>
      one<{ id: string }>("insert into public.sessions (host_id, title) values ($1, 'Elsewhere') returning id", [STRANGER]),
    );
    const outsider = (await one<{ id: string }>("select id from public.participants where session_id = $1", [other.id])).id;
    await expect(edit(ANA, tea, 1, "", true, [pid.ana, outsider])).rejects.toThrow(/not at this table/);
    expect(await forOf(tea)).toEqual([pid.ana]);
  });

  it("quantity can't drop below what's already been served", async () => {
    const beer = await addItem(BEN, "Beer", 3, pid.ben);
    await db.query("insert into public.delivery_events (order_item_id, delta) values ($1, 1)", [beer]);
    await db.query("insert into public.delivery_events (order_item_id, delta) values ($1, 1)", [beer]);
    await expect(edit(BEN, beer, 1, "", false, [pid.ben])).rejects.toThrow(/already served/);
    expect((await itemOf(beer)).quantity).toBe(3);
  });
});

describe("who can change an order", () => {
  it("not someone else at the table, and not a stranger", async () => {
    const latte = await addItem(ANA, "Latte", 1, pid.ana);
    await expect(edit(BEN, latte, 1, "", true, [pid.ana, pid.ben])).rejects.toThrow(/Only the person who ordered it or the table's creator/);
    await expect(edit(STRANGER, latte, 1, "", false, [pid.ana])).rejects.toThrow(/not part of this table/);
    expect(await forOf(latte)).toEqual([pid.ana]);
  });

  it("nobody can update items or who they're for directly, so the rules can't be skipped", async () => {
    const latte = await addItem(ANA, "Mocha", 1, pid.ana);
    await expect(as(db, ANA, () => db.query("update public.order_items set quantity = 2 where id = $1", [latte]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as(db, ANA, () => db.query("insert into public.order_item_assignees (order_item_id, participant_id) values ($1, $2)", [latte, pid.ben])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, ANA, () => db.query("delete from public.order_item_assignees where order_item_id = $1", [latte])),
    ).rejects.toThrow(/permission denied/);
  });

  it("adding items still works, and still needs ordering to be open", async () => {
    await setStatus("closed");
    await expect(addItem(ANA, "Late snack", 1, pid.ana)).rejects.toThrow(/Ordering is closed/);
    await setStatus("open");
  });

  it("the orderer can still change it after ordering has closed", async () => {
    const cake = await addItem(ANA, "Cake", 1, pid.ana);
    await setStatus("closed");
    await edit(ANA, cake, 1, "", true, [pid.ana, pid.host]);
    expect(await forOf(cake)).toEqual([pid.ana, pid.host].sort());
    await setStatus("open");
  });

  it("the host can change someone else's order, and that person is told in the app", async () => {
    const water = await addItem(BEN, "Water", 2, pid.ben);
    await edit(HOST, water, 2, "", true, [pid.ben, pid.ana]);
    expect(await notificationsFor(BEN.id)).toEqual(["Ronnel changed your order at Friday dinner: 2× Water, shared by Ana, you."]);
    expect(await notificationsFor(ANA)).toEqual([]);
    expect(await notificationsFor(HOST)).toEqual([]);
  });

  it("saving with no changes tells nobody", async () => {
    const soda = await addItem(BEN, "Soda", 1, pid.ben);
    const before = (await notificationsFor(BEN.id)).length;
    await edit(HOST, soda, 1, "", false, [pid.ben]);
    expect(await notificationsFor(BEN.id)).toHaveLength(before);
  });

  it("changing an item that's gone says so", async () => {
    await expect(edit(HOST, "00000000-0000-0000-0000-000000000000", 1, "", false, [pid.host])).rejects.toThrow(/removed/);
  });
});

describe("until the bill is paid", () => {
  let latte: string;

  it("after the bill is sent but before anyone pays, a change takes the bill back", async () => {
    latte = await addItem(ANA, "Iced latte", 1, pid.ana);
    await sendBill(latte, pid.ana);
    expect(await statusOf()).toBe("billing");

    // Saving without changes doesn't take the bill back.
    await edit(ANA, latte, 1, "", false, [pid.ana]);
    expect(await statusOf()).toBe("billing");

    await edit(ANA, latte, 1, "", true, [pid.ana, pid.ben]);
    expect(await statusOf()).toBe("closed");
    expect((await one<{ status: string }>("select status from public.receipts where session_id = $1", [sessionId])).status).toBe("review");
    expect((await db.query("select 1 from public.bill_shares where session_id = $1", [sessionId])).rows).toHaveLength(0);
  });

  it("once anyone has paid, nobody can change anything", async () => {
    await setStatus("open");
    await sendBill(latte, pid.ana);
    await as(db, ANA, () => db.query("select public.mark_paid($1, $2, true)", [sessionId, pid.ana]));
    await expect(edit(ANA, latte, 1, "", false, [pid.ana])).rejects.toThrow(/bill has been paid/);
    await expect(edit(HOST, latte, 1, "", false, [pid.ana])).rejects.toThrow(/bill has been paid/);
    expect(await statusOf()).toBe("billing");
  });

  it("nor once the table is settled", async () => {
    await as(db, HOST, () => db.query("select public.reopen_bill($1)", [sessionId]));
    await setStatus("settled");
    await expect(edit(HOST, latte, 1, "", false, [pid.ana])).rejects.toThrow(/bill has been paid/);
  });
});
