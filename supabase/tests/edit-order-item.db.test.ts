import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-27: edit an order's quantity, notes and sharing after it's placed.
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

const addItem = (actor: string | typeof BEN, name: string, forPid: string, quantity = 1) =>
  as(db, actor, () =>
    one<{ id: string }>("select public.add_order_item($1, $2, 25000, $3, '', false, $4) as id", [sessionId, name, quantity, [forPid]]),
  ).then((r) => r.id);

type Person = { participant_id: string; weight?: number };
const edit = (actor: string | typeof BEN, itemId: string, quantity: number, notes: string, people: Person[] | null = null) =>
  as(db, actor, () =>
    db.query("select public.edit_order_item($1, $2, $3, $4)", [itemId, quantity, notes, people === null ? null : JSON.stringify(people)]),
  );

const item = (id: string) =>
  one<{ quantity: number; notes: string; is_shared: boolean }>("select quantity, notes, is_shared from public.order_items where id = $1", [id]);
const people = async (id: string) =>
  (
    await db.query<{ participant_id: string; share_weight: number }>(
      "select participant_id, share_weight from public.order_item_assignees where order_item_id = $1 order by share_weight, participant_id",
      [id],
    )
  ).rows.map((r) => [r.participant_id, r.share_weight]);
const notices = async (userId: string) =>
  (
    await db.query<{ kind: string; body: string }>(
      "select kind, body from public.notifications where user_id = $1 order by created_at, body",
      [userId],
    )
  ).rows;

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, email) values ($1, 'h@x'), ($2, 'a@x'), ($3, null), ($4, 's@x')", [
    HOST,
    ANA,
    BEN.id,
    STRANGER,
  ]);
  const s = await as(db, HOST, () =>
    one<{ id: string; join_code: string }>(
      "insert into public.sessions (host_id, title) values ($1, 'Kamayan Friday') returning id, join_code",
      [HOST],
    ),
  );
  sessionId = s.id;
  await as(db, HOST, () => db.query("update public.participants set display_name = 'Ron' where session_id = $1", [sessionId]));
  await as(db, ANA, () => db.query("select public.join_session($1, 'Ana')", [s.join_code]));
  await as(db, BEN, () => db.query("select public.join_session($1, 'Ben')", [s.join_code]));
  const ps = await db.query<{ id: string; user_id: string }>("select id, user_id from public.participants where session_id = $1", [sessionId]);
  pid.host = ps.rows.find((r) => r.user_id === HOST)!.id;
  pid.ana = ps.rows.find((r) => r.user_id === ANA)!.id;
  pid.ben = ps.rows.find((r) => r.user_id === BEN.id)!.id;
}, 60_000);

describe("editing an order", () => {
  it("the orderer can change quantity, notes and sharing in one step, without a notification", async () => {
    const id = await addItem(ANA, "Sinigang", pid.ana);
    await edit(ANA, id, 2, "  less sour  ", [
      { participant_id: pid.ana, weight: 2 },
      { participant_id: pid.ben, weight: 1 },
    ]);
    expect(await item(id)).toEqual({ quantity: 2, notes: "less sour", is_shared: true });
    expect(await people(id)).toEqual([
      [pid.ben, 1],
      [pid.ana, 2],
    ]);
    expect(await notices(ANA)).toEqual([]);
  });

  it("null people keeps the sharing as it is", async () => {
    const id = await addItem(ANA, "Rice", pid.ana);
    await edit(ANA, id, 3, "");
    expect(await item(id)).toEqual({ quantity: 3, notes: "", is_shared: false });
    expect(await people(id)).toEqual([[pid.ana, 1]]);
  });

  it("back to one person stores a single portion and is not shared", async () => {
    const id = await addItem(ANA, "Halo-halo", pid.ana);
    await edit(ANA, id, 1, "", [{ participant_id: pid.ana }, { participant_id: pid.ben }]);
    await edit(ANA, id, 1, "", [{ participant_id: pid.ben, weight: 4 }]);
    expect(await item(id)).toMatchObject({ is_shared: false });
    expect(await people(id)).toEqual([[pid.ben, 1]]);
  });

  it("other members and strangers can't edit someone's order", async () => {
    const id = await addItem(BEN, "Lumpia", pid.ben);
    await expect(edit(ANA, id, 2, "")).rejects.toThrow(/Only the person who ordered it or the table's creator/);
    await expect(edit(STRANGER, id, 2, "")).rejects.toThrow(/not part of this table/);
    expect(await item(id)).toMatchObject({ quantity: 1 });
  });

  it("rejects a bad quantity or people list", async () => {
    const id = await addItem(ANA, "Adobo", pid.ana);
    await expect(edit(ANA, id, 0, "")).rejects.toThrow(/between 1 and 99/);
    await expect(edit(ANA, id, 100, "")).rejects.toThrow(/between 1 and 99/);
    await expect(edit(ANA, id, 1, "", [])).rejects.toThrow(/at least one person/);
    await expect(edit(ANA, id, 1, "", [{ participant_id: pid.ana }, { participant_id: pid.ana }])).rejects.toThrow(/listed twice/);
    await expect(edit(ANA, id, 1, "", [{ participant_id: pid.ana, weight: 11 }])).rejects.toThrow(/between 1 and 10/);
  });

  it("notes are cut to 200 characters", async () => {
    const id = await addItem(ANA, "Pancit", pid.ana);
    await edit(ANA, id, 1, "x".repeat(250));
    expect((await item(id)).notes).toHaveLength(200);
  });

  it("direct updates are blocked: edits must go through edit_order_item", async () => {
    const id = await addItem(ANA, "Bulalo", pid.ana);
    await expect(
      as(db, ANA, () => db.query("update public.order_items set quantity = 5 where id = $1", [id])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("telling the orderer", () => {
  it("when the host changes someone's order, they get a notification saying what changed", async () => {
    const id = await addItem(ANA, "Crispy pata", pid.ana, 2);
    await edit(HOST, id, 3, "extra crispy", [{ participant_id: pid.ana }, { participant_id: pid.ben }]);
    expect(await notices(ANA)).toEqual([
      {
        kind: "order_changed",
        body: 'Ron changed your order of 2× Crispy pata at Kamayan Friday: quantity 2 → 3; note: "extra crispy"; now shared by Ana, Ben.',
      },
    ]);
  });

  it("set_item_sharing (OTC-32) also tells them", async () => {
    const id = await addItem(BEN, "Kare-kare", pid.ben);
    await as(db, HOST, () =>
      db.query("select public.set_item_sharing($1, $2)", [id, JSON.stringify([{ participant_id: pid.host }])]),
    );
    expect((await notices(BEN.id)).map((n) => n.body)).toEqual(["Ron changed your order of Kare-kare at Kamayan Friday: now for Ron."]);
  });

  it("saving with no changes does nothing and sends nothing", async () => {
    const id = await addItem(ANA, "Ensaymada", pid.ana);
    const before = (await notices(ANA)).length;
    await edit(HOST, id, 1, "", [{ participant_id: pid.ana }]);
    expect(await notices(ANA)).toHaveLength(before);
  });

  it("the host editing their own order isn't notified", async () => {
    const id = await addItem(HOST, "Leche flan", pid.host);
    await edit(HOST, id, 2, "");
    expect(await notices(HOST)).toEqual([]);
  });
});

describe("until the bill is paid", () => {
  let id: string;

  async function sendBill() {
    await as(db, HOST, async () => {
      await db.query("delete from public.receipts where session_id = $1", [sessionId]);
      const r = await one<{ id: string }>("insert into public.receipts (session_id) values ($1) returning id", [sessionId]);
      const l = await one<{ id: string }>(
        "insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos) values ($1, $2, 'SISIG', 25000) returning id",
        [r.id, sessionId],
      );
      await db.query("insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id) values ($1, $2, $3)", [
        l.id,
        id,
        sessionId,
      ]);
      const shares = Object.values(pid).map((p) => {
        const amt = p === pid.ana ? 25000 : 0;
        return { participant_id: p, items_centavos: amt, service_centavos: 0, tax_centavos: 0, discount_centavos: 0, tip_centavos: 0, total_centavos: amt, breakdown: [] };
      });
      await db.query("select public.finalize_bill($1, $2)", [sessionId, JSON.stringify(shares)]);
    });
  }
  const status = async () => (await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status;

  it("an edit after the bill is sent takes the bill back", async () => {
    id = await addItem(ANA, "Sisig", pid.ana);
    await sendBill();
    expect(await status()).toBe("billing");
    await edit(ANA, id, 2, "");
    expect(await status()).toBe("closed");
    expect((await db.query("select 1 from public.bill_shares where session_id = $1", [sessionId])).rows).toHaveLength(0);
  });

  it("a no-change save leaves a sent bill alone", async () => {
    await sendBill();
    await edit(ANA, id, 2, "");
    expect(await status()).toBe("billing");
  });

  it("once someone has paid, nobody can edit", async () => {
    await as(db, ANA, () => db.query("select public.mark_paid($1, $2, true)", [sessionId, pid.ana]));
    await expect(edit(HOST, id, 3, "")).rejects.toThrow(/bill has been paid/);
    await expect(edit(ANA, id, 3, "")).rejects.toThrow(/bill has been paid/);
  });
});
