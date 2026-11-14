import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000c001";
const USER = "00000000-0000-0000-0000-00000000c002";

let db: PGlite;
let storeId: string;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com'), ($2, 'user@example.com')`, [ADMIN, USER]);
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
  const r = await as(db, ADMIN, () =>
    db.query<{ id: string }>(`insert into public.stores (name, status) values ('Kainan', 'published') returning id`),
  );
  storeId = r.rows[0].id;
}, 60_000);

describe("stores.custom_category_order (OTC-24)", () => {
  it("defaults to the diner-friendly order", async () => {
    const r = await db.query<{ custom_category_order: boolean }>(`select custom_category_order from public.stores where id = $1`, [storeId]);
    expect(r.rows[0].custom_category_order).toBe(false);
  });

  it("store admins can switch a store to their own order", async () => {
    await as(db, ADMIN, () => db.query(`update public.stores set custom_category_order = true where id = $1`, [storeId]));
    const r = await db.query<{ custom_category_order: boolean }>(`select custom_category_order from public.stores where id = $1`, [storeId]);
    expect(r.rows[0].custom_category_order).toBe(true);
  });

  it("regular users can read it but not change it", async () => {
    const seen = await as(db, USER, () =>
      db.query<{ custom_category_order: boolean }>(`select custom_category_order from public.stores where id = $1`, [storeId]),
    );
    expect(seen.rows).toEqual([{ custom_category_order: true }]);
    const upd = await as(db, USER, () =>
      db.query(`update public.stores set custom_category_order = false where id = $1 returning id`, [storeId]),
    );
    expect(upd.rows).toHaveLength(0);
  });
});
