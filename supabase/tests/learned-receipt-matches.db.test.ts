import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { matchTarget, receiptTextKey } from "../../src/lib/bill";
import { as, createTestDb } from "./db";

const HOST = "00000000-0000-0000-0000-00000000f001";
const HOST2 = "00000000-0000-0000-0000-00000000f002";
const GUEST = "00000000-0000-0000-0000-00000000f003";

let db: PGlite;
let store: string;
const menu: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

/** A table at the store with these orders, and a receipt in review. */
async function table(host: string, orders: { name: string; menu?: string }[], atStore = true) {
  const s = await one<{ id: string; join_code: string }>(
    `insert into public.sessions (host_id, title, store_id) values ($1, 'Dinner', $2) returning id, join_code`,
    [host, atStore ? store : null],
  );
  const me = await one<{ id: string }>(`select id from public.participants where session_id = $1 and user_id = $2`, [s.id, host]);
  const items: string[] = [];
  for (const o of orders) {
    items.push(
      (await one<{ id: string }>(
        `insert into public.order_items (session_id, added_by, name, unit_price_centavos, menu_item_id) values ($1, $2, $3, 10000, $4) returning id`,
        [s.id, me.id, o.name, o.menu ? menu[o.menu] : null],
      )).id,
    );
  }
  const receipt = (await one<{ id: string }>(`insert into public.receipts (session_id) values ($1) returning id`, [s.id])).id;
  return { session: s.id, joinCode: s.join_code, receipt, items };
}

/** Receipt lines, each matched to the given order items. */
async function lines(t: { session: string; receipt: string }, rows: { text: string; items: string[] }[]) {
  for (const [i, r] of rows.entries()) {
    const line = await one<{ id: string }>(
      `insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos, sort_order) values ($1, $2, $3, 10000, $4) returning id`,
      [t.receipt, t.session, r.text, i],
    );
    for (const item of r.items) {
      await db.query(`insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id) values ($1, $2, $3)`, [line.id, item, t.session]);
    }
  }
}

const send = (receipt: string) => db.query(`update public.receipts set status = 'final' where id = $1`, [receipt]);
const takeBack = (receipt: string) => db.query(`update public.receipts set status = 'review' where id = $1`, [receipt]);
const learned = (host: string, session: string) =>
  as(db, host, () =>
    db.query<{ text_key: string; target: string; score: number }>(
      `select * from public.learned_receipt_matches($1) order by text_key, target`,
      [session],
    ),
  ).then((r) => r.rows);

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`insert into auth.users (id, email) values ($1,'h@x'),($2,'h2@x'),($3,'g@x')`, [HOST, HOST2, GUEST]);
  store = (await one<{ id: string }>(`insert into public.stores (name, status) values ('Kainan', 'published') returning id`)).id;
  const cat = (await one<{ id: string }>(`insert into public.menu_categories (store_id, name) values ($1, 'Mains') returning id`, [store])).id;
  for (const [key, name] of [["adobo", "Chicken Adobo with Rice"], ["sisig", "Pork Sisig"]]) {
    menu[key] = (await one<{ id: string }>(
      `insert into public.menu_items (store_id, category_id, name, base_price_centavos) values ($1, $2, $3, 10000) returning id`,
      [store, cat, name],
    )).id;
  }
}, 60_000);

describe("learned receipt matches (OTC-29)", () => {
  it("uses the same text key and target as the app", async () => {
    for (const text of ["  CHKN-ADOBO w/ Rice ", "2 ICED LATTE", "2x Iced Latte", "Jalapeño Poppers", "COKE 1.5L", "x"]) {
      const r = await one<{ k: string }>(`select public.receipt_text_key($1) as k`, [text]);
      expect(r.k).toBe(receiptTextKey(text));
    }
    const r = await one<{ a: string; b: string }>(
      `select public.order_item_match_target($1, 'X') as a, public.order_item_match_target(null, 'Halo-Halo!') as b`,
      [menu.adobo],
    );
    expect(r).toEqual({ a: matchTarget({ menu_item_id: menu.adobo, name: "X" }), b: matchTarget({ menu_item_id: null, name: "Halo-Halo!" }) });
  });

  it("learns nothing until the bill is sent", async () => {
    const t = await table(HOST, [{ name: "Chicken Adobo with Rice", menu: "adobo" }]);
    await lines(t, [{ text: "SPCL #4", items: t.items }]);
    expect(await learned(HOST, t.session)).toEqual([]);
    await send(t.receipt);
    expect(await learned(HOST, t.session)).toEqual([{ text_key: "spcl 4", target: `menu:${menu.adobo}`, score: 1 }]);
  });

  it("shares what was learned with other hosts at the same store", async () => {
    const t = await table(HOST2, [{ name: "Halo-halo" }]);
    expect(await learned(HOST2, t.session)).toEqual([{ text_key: "spcl 4", target: `menu:${menu.adobo}`, score: 1 }]);
    await lines(t, [{ text: "HH DESSERT", items: t.items }]);
    await send(t.receipt);
    expect((await learned(HOST2, t.session)).map((m) => [m.text_key, m.target, m.score])).toEqual([
      ["hh dessert", "name:halo halo", 1],
      ["spcl 4", `menu:${menu.adobo}`, 1],
    ]);
  });

  it("only the host can look it up; tables without a store have nothing", async () => {
    const t = await table(HOST, []);
    await as(db, GUEST, () => db.query(`select public.join_session($1)`, [t.joinCode]));
    await expect(learned(GUEST, t.session)).rejects.toThrow(/Only the host/);
    await expect(as(db, GUEST, () => db.query(`select * from public.receipt_match_votes`))).rejects.toThrow(/permission denied/);
    const noStore = await table(HOST, [{ name: "Pork Sisig" }], false);
    expect(await learned(HOST, noStore.session)).toEqual([]);
  });

  it("a correction outvotes a wrong learned match", async () => {
    // Someone matched "SPCL #4" to adobo once. This time the host fixes it to sisig.
    const t = await table(HOST, [
      { name: "Chicken Adobo with Rice", menu: "adobo" },
      { name: "Pork Sisig", menu: "sisig" },
    ]);
    await lines(t, [{ text: "spcl 4", items: [t.items[1]] }]);
    await send(t.receipt);
    const spcl = (await learned(HOST, t.session)).filter((m) => m.text_key === "spcl 4");
    // adobo: +1 -1 = 0, dropped; sisig: +1
    expect(spcl).toEqual([{ text_key: "spcl 4", target: `menu:${menu.sisig}`, score: 1 }]);
  });

  it("sending the same bill again replaces its votes instead of adding more", async () => {
    const t = await table(HOST, [{ name: "Pork Sisig", menu: "sisig" }]);
    await lines(t, [{ text: "SIZZ SISIG", items: t.items }]);
    await send(t.receipt);
    await takeBack(t.receipt);
    await send(t.receipt);
    const m = (await learned(HOST, t.session)).filter((x) => x.text_key === "sizz sisig");
    expect(m).toEqual([{ text_key: "sizz sisig", target: `menu:${menu.sisig}`, score: 1 }]);
  });

  it("the scan can mark how a match was made; it defaults to manual", async () => {
    const t = await as(db, HOST, async () => {
      const s = await one<{ id: string }>(`insert into public.sessions (host_id, title, store_id) values ($1, 'Lunch', $2) returning id`, [HOST, store]);
      const p = await one<{ id: string }>(`select id from public.participants where session_id = $1`, [s.id]);
      const item = await one<{ id: string }>(`select public.add_order_item($1, 'Latte', 10000, 1, '', false, $2) as id`, [s.id, [p.id]]);
      const r = await one<{ id: string }>(`insert into public.receipts (session_id) values ($1) returning id`, [s.id]);
      const l1 = await one<{ id: string }>(
        `insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos) values ($1, $2, 'LATTE', 10000) returning id`,
        [r.id, s.id],
      );
      await db.query(`insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id, source) values ($1, $2, $3, 'learned')`, [l1.id, item.id, s.id]);
      return { session: s.id };
    });
    const rows = await db.query<{ source: string }>(`select source from public.receipt_line_items where session_id = $1`, [t.session]);
    expect(rows.rows).toEqual([{ source: "learned" }]);
    await expect(
      db.query(`update public.receipt_line_items set source = 'bogus' where session_id = $1`, [t.session]),
    ).rejects.toThrow(/check constraint/);
  });
});
