import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asVisitor, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000e001";
const ANA = "00000000-0000-0000-0000-00000000e002"; // host
const GUEST = "00000000-0000-0000-0000-00000000e003";
const BEN = "00000000-0000-0000-0000-00000000e004"; // not at the table
const DIA = "00000000-0000-0000-0000-00000000e005";
const guest = { id: GUEST, anonymous: true };

let db: PGlite;
let tableId: string;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email, is_anonymous) values
       ($1, 'admin@example.com', false), ($2, 'ana@example.com', false), ($3, null, true),
       ($4, 'ben@example.com', false), ($5, 'dia@example.com', false)`,
    [ADMIN, ANA, GUEST, BEN, DIA],
  );
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
  const s = await db.query<{ id: string }>(`insert into public.sessions (host_id, title) values ($1, 'Friday dinner') returning id`, [ANA]);
  tableId = s.rows[0].id;
  await db.query(
    `insert into public.participants (session_id, user_id, display_name) values ($1, $2, 'Carlo'), ($1, $3, 'Dia')
     on conflict do nothing`,
    [tableId, GUEST, DIA],
  );
}, 60_000);

const due = (who: string | typeof guest) =>
  as(db, who, () => db.query<{ due: boolean }>(`select public.post_meal_rating_due($1) as due`, [tableId])).then(
    (r) => r.rows[0].due,
  );
const rate = (rating: number, message = "", table = tableId) =>
  db
    .query<{ id: string }>(`select public.submit_post_meal_rating($1, $2, $3, 'test-agent') as id`, [table, rating, message])
    .then((r) => r.rows[0].id);
const row = (id: string) =>
  db.query<Record<string, unknown>>(`select * from public.feedback where id = $1`, [id]).then((r) => r.rows[0]);

describe("post-meal rating", () => {
  it("isn't asked or accepted before the bill is sent", async () => {
    expect(await due(ANA)).toBe(false);
    await expect(as(db, ANA, () => rate(5))).rejects.toThrow(/once the bill is sent/);
  });

  it("is asked once the receipt is final, only of people at the table", async () => {
    await db.query(`insert into public.receipts (session_id, status) values ($1, 'final')`, [tableId]);
    expect(await due(ANA)).toBe(true);
    expect(await due(guest)).toBe(true);
    expect(await due(BEN)).toBe(false);
    await expect(as(db, BEN, () => rate(4))).rejects.toThrow(/table you're at/);
  });

  it("records a guest's rating with their table name, once", async () => {
    const id = await as(db, guest, () => rate(2, "  Receipt scan missed an item  "));
    expect(await row(id)).toMatchObject({
      user_id: GUEST,
      sender_name: "Carlo",
      sender_is_guest: true,
      kind: "post_meal",
      category: null,
      rating: 2,
      message: "Receipt scan missed an item",
      page_path: `/s/${tableId}`,
      session_id: tableId,
      table_title: "Friday dinner",
      status: "new",
    });
    expect(await due(guest)).toBe(false);
    await expect(as(db, guest, () => rate(5))).rejects.toThrow(/already rated/);
  });

  it("files ratings without a comment as already read", async () => {
    const id = await as(db, ANA, () => rate(5));
    expect(await row(id)).toMatchObject({ rating: 5, message: "", status: "read", sender_is_guest: false });
  });

  it("checks the input", async () => {
    await expect(as(db, DIA, () => rate(0))).rejects.toThrow(/1 to 5/);
    await expect(as(db, DIA, () => rate(6))).rejects.toThrow(/1 to 5/);
    await expect(as(db, DIA, () => rate(3, "x".repeat(501)))).rejects.toThrow(/500/);
  });

  it("remembers \"Not now\"", async () => {
    expect(await due(DIA)).toBe(true);
    await as(db, DIA, () => db.query(`select public.dismiss_post_meal_rating($1)`, [tableId]));
    await as(db, DIA, () => db.query(`select public.dismiss_post_meal_rating($1)`, [tableId])); // twice is fine
    expect(await due(DIA)).toBe(false);
    await expect(as(db, BEN, () => db.query(`select public.dismiss_post_meal_rating($1)`, [tableId]))).rejects.toThrow(
      /table you're at/,
    );
  });

  it("needs a login, and only admins can read ratings", async () => {
    await expect(asVisitor(db, () => rate(5))).rejects.toThrow(/permission denied/);
    const mine = await as(db, ANA, () => db.query(`select * from public.feedback`));
    expect(mine.rows).toHaveLength(0);
    await expect(as(db, ANA, () => db.query(`select * from public.post_meal_prompt_dismissals`))).rejects.toThrow(
      /permission denied/,
    );
    const all = await as(db, ADMIN, () => db.query(`select * from public.feedback where kind = 'post_meal'`));
    expect(all.rows).toHaveLength(2);
  });
});
