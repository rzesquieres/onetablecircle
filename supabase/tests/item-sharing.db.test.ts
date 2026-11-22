import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-32: change who shares an item and how many portions each person has.
const HOST = "00000000-0000-0000-0000-0000000032a1";
const ANA = "00000000-0000-0000-0000-0000000032b2";
const BEN = { id: "00000000-0000-0000-0000-0000000032c3", anonymous: true };
const STRANGER = "00000000-0000-0000-0000-0000000032d4";

let db: PGlite;
let sessionId: string;
let otherSessionPid: string;
const pid: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

const addItem = (actor: string | typeof BEN, name: string, forPid: string) =>
  as(db, actor, () =>
    one<{ id: string }>("select public.add_order_item($1, $2, 30000, 1, '', false, $3) as id", [sessionId, name, [forPid]]),
  ).then((r) => r.id);

type Person = { participant_id: string; weight?: number };
const share = (actor: string | typeof BEN, itemId: string, people: Person[] | null) =>
  as(db, actor, () => db.query("select public.set_item_sharing($1, $2)", [itemId, people === null ? null : JSON.stringify(people)]));

const sharing = async (itemId: string) => {
  const rows = (
    await db.query<{ participant_id: string; share_weight: number }>(
      "select participant_id, share_weight from public.order_item_assignees where order_item_id = $1 order by share_weight, participant_id",
      [itemId],
    )
  ).rows;
  const item = await one<{ is_shared: boolean }>("select is_shared from public.order_items where id = $1", [itemId]);
  return { shared: item.is_shared, people: rows.map((r) => [r.participant_id, r.share_weight]) };
};

const setStatus = (status: string) =>
  as(db, HOST, () => db.query("update public.sessions set status = $2 where id = $1", [sessionId, status]));

async function sendBill(itemId: string) {
  await as(db, HOST, async () => {
    await db.query("delete from public.receipts where session_id = $1", [sessionId]);
    const r = await one<{ id: string }>("insert into public.receipts (session_id) values ($1) returning id", [sessionId]);
    const l = await one<{ id: string }>(
      "insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos) values ($1, $2, 'ITEM', 30000) returning id",
      [r.id, sessionId],
    );
    await db.query("insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id) values ($1, $2, $3)", [
      l.id,
      itemId,
      sessionId,
    ]);
    const shares = Object.values(pid).map((p) => {
      const amt = p === pid.ana ? 30000 : 0;
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
    one<{ id: string; join_code: string }>("insert into public.sessions (host_id, title) values ($1, 'Lechon night') returning id, join_code", [HOST]),
  );
  sessionId = s.id;
  await as(db, ANA, () => db.query("select public.join_session($1, 'Ana')", [s.join_code]));
  await as(db, BEN, () => db.query("select public.join_session($1, 'Ben')", [s.join_code]));
  const ps = await db.query<{ id: string; user_id: string }>("select id, user_id from public.participants where session_id = $1", [sessionId]);
  pid.host = ps.rows.find((r) => r.user_id === HOST)!.id;
  pid.ana = ps.rows.find((r) => r.user_id === ANA)!.id;
  pid.ben = ps.rows.find((r) => r.user_id === BEN.id)!.id;

  const other = await as(db, STRANGER, () =>
    one<{ id: string }>("insert into public.sessions (host_id, title) values ($1, 'Elsewhere') returning id", [STRANGER]),
  );
  otherSessionPid = (await one<{ id: string }>("select id from public.participants where session_id = $1", [other.id])).id;
}, 60_000);

describe("changing who shares an item", () => {
  it("the orderer can share it with portions, and back to one person", async () => {
    const lechon = await addItem(ANA, "Lechon", pid.ana);
    await share(ANA, lechon, [
      { participant_id: pid.ana, weight: 2 },
      { participant_id: pid.ben, weight: 1 },
    ]);
    expect(await sharing(lechon)).toEqual({ shared: true, people: [[pid.ben, 1], [pid.ana, 2]] });

    await share(ANA, lechon, [{ participant_id: pid.ben }]);
    expect(await sharing(lechon)).toEqual({ shared: false, people: [[pid.ben, 1]] });
  });

  it("the host can change anyone's item; others and strangers can't", async () => {
    const pitcher = await addItem(BEN, "Iced tea pitcher", pid.ben);
    const all = [{ participant_id: pid.host }, { participant_id: pid.ana }, { participant_id: pid.ben }];
    await expect(share(ANA, pitcher, all)).rejects.toThrow(/Only the person who ordered it or the table's creator/);
    await expect(share(STRANGER, pitcher, all)).rejects.toThrow(/not part of this table/);
    await share(HOST, pitcher, all);
    expect((await sharing(pitcher)).people).toHaveLength(3);
  });

  it("rejects bad lists", async () => {
    const sisig = await addItem(ANA, "Sisig", pid.ana);
    await expect(share(ANA, sisig, [])).rejects.toThrow(/at least one person/);
    await expect(share(ANA, sisig, null)).rejects.toThrow(/at least one person/);
    await expect(share(ANA, sisig, [{ participant_id: pid.ana, weight: 0 }])).rejects.toThrow(/between 1 and 10/);
    await expect(share(ANA, sisig, [{ participant_id: pid.ana, weight: 11 }])).rejects.toThrow(/between 1 and 10/);
    await expect(share(ANA, sisig, [{ participant_id: pid.ana }, { participant_id: pid.ana }])).rejects.toThrow(/listed twice/);
    await expect(share(ANA, sisig, [{ participant_id: otherSessionPid }])).rejects.toThrow(/at this table/);
    expect(await sharing(sisig)).toEqual({ shared: false, people: [[pid.ana, 1]] });
  });

  it("can be called twice in one transaction", async () => {
    const rice = await addItem(ANA, "Rice", pid.ana);
    await as(db, ANA, () =>
      db.transaction(async (tx) => {
        await tx.query("select public.set_item_sharing($1, $2)", [rice, JSON.stringify([{ participant_id: pid.ben }])]);
        await tx.query("select public.set_item_sharing($1, $2)", [rice, JSON.stringify([{ participant_id: pid.host }])]);
      }),
    );
    expect((await sharing(rice)).people).toEqual([[pid.host, 1]]);
  });
});

describe("until the bill is paid", () => {
  let item: string;

  it("after the bill is sent, changing the split takes the bill back", async () => {
    item = await addItem(ANA, "Kare-kare", pid.ana);
    await sendBill(item);
    await share(ANA, item, [{ participant_id: pid.ana }, { participant_id: pid.ben }]);
    expect((await one<{ status: string }>("select status from public.sessions where id = $1", [sessionId])).status).toBe("closed");
    expect((await db.query("select 1 from public.bill_shares where session_id = $1", [sessionId])).rows).toHaveLength(0);
  });

  it("once someone has paid, nobody can change it", async () => {
    await setStatus("open");
    await sendBill(item);
    await as(db, ANA, () => db.query("select public.mark_paid($1, $2, true)", [sessionId, pid.ana]));
    await expect(share(HOST, item, [{ participant_id: pid.host }])).rejects.toThrow(/bill has been paid/);
  });
});
