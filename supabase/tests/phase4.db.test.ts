import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000bd01";
const USER = "00000000-0000-0000-0000-00000000b002";
const GUEST = { id: "00000000-0000-0000-0000-00000000b003", anonymous: true };

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

const draft = {
  store: { name: "Kape Ni Juan", branch: "Makati", source_url: "https://example.com/menu" },
  option_groups: [
    {
      name: "Size",
      selection: "single",
      min_select: 1,
      max_select: null,
      options: [
        { name: "Regular", price_delta_centavos: 0 },
        { name: "Large", price_delta_centavos: 3000 },
      ],
    },
  ],
  categories: [
    {
      name: "Coffee",
      items: [
        { name: "Spanish latte", description: "Sweet", base_price_centavos: 16500, option_groups: ["size"] },
        { name: "Americano", description: "", base_price_centavos: 12000, option_groups: ["Size", "Unknown"] },
      ],
    },
    { name: "Pastries", items: [{ name: "Ensaymada", description: "", base_price_centavos: 9000, option_groups: [] }] },
  ],
};

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email) values ($1, 'admin@example.com'), ($2, 'user@example.com'), ($3, null)`,
    [ADMIN, USER, GUEST.id],
  );
  await db.query("update public.profiles set is_platform_admin = true where user_id = $1", [ADMIN]);
}, 60_000);

describe("AI add store: draft then apply", () => {
  let jobId: string;
  let storeId: string;

  it("only admins can create and see import jobs", async () => {
    jobId = (await as(db, ADMIN, () =>
      one<{ id: string }>(
        `insert into public.menu_import_jobs (kind, input) values ('add_store', '{"name":"Kape Ni Juan"}') returning id`,
      ),
    )).id;
    await expect(
      as(db, USER, () => db.query(`insert into public.menu_import_jobs (kind) values ('add_store')`)),
    ).rejects.toThrow(/row-level security/);
    const seen = await as(db, USER, () => db.query(`select 1 from public.menu_import_jobs`));
    expect(seen.rows).toHaveLength(0);
  });

  it("cannot be applied while still running", async () => {
    await expect(
      as(db, ADMIN, () => db.query(`select public.apply_menu_import($1, $2)`, [jobId, JSON.stringify(draft)])),
    ).rejects.toThrow(/is running/);
  });

  it("applying creates a draft store with estimated prices and linked options", async () => {
    await as(db, ADMIN, () =>
      db.query(`update public.menu_import_jobs set status = 'ready', result = '{}' where id = $1`, [jobId]),
    );
    storeId = (await as(db, ADMIN, () =>
      one<{ id: string }>(`select public.apply_menu_import($1, $2) as id`, [jobId, JSON.stringify(draft)]),
    )).id;

    const store = await one<{ name: string; branch: string; status: string; source_url: string }>(
      `select name, branch, status, source_url from public.stores where id = $1`,
      [storeId],
    );
    expect(store).toEqual({ name: "Kape Ni Juan", branch: "Makati", status: "draft", source_url: "https://example.com/menu" });

    const items = await db.query<{ name: string; price: string; price_status: string; groups: string }>(
      `select i.name, i.base_price_centavos::text as price, i.price_status::text,
              (select count(*) from public.menu_item_option_groups l where l.menu_item_id = i.id)::text as groups
       from public.menu_items i where i.store_id = $1 order by i.name`,
      [storeId],
    );
    expect(items.rows).toEqual([
      { name: "Americano", price: "12000", price_status: "estimated", groups: "1" },
      { name: "Ensaymada", price: "9000", price_status: "estimated", groups: "0" },
      { name: "Spanish latte", price: "16500", price_status: "estimated", groups: "1" },
    ]);
    const opts = await db.query(`select name from public.options where store_id = $1 order by sort_order`, [storeId]);
    expect(opts.rows.map((r) => (r as { name: string }).name)).toEqual(["Regular", "Large"]);

    const job = await one<{ status: string; store_id: string }>(
      `select status, store_id from public.menu_import_jobs where id = $1`,
      [jobId],
    );
    expect(job).toEqual({ status: "applied", store_id: storeId });
  });

  it("cannot be applied twice", async () => {
    await expect(
      as(db, ADMIN, () => db.query(`select public.apply_menu_import($1, $2)`, [jobId, JSON.stringify(draft)])),
    ).rejects.toThrow(/is applied/);
  });

  it("importing into an existing store reuses categories and option groups by name", async () => {
    const job2 = (await as(db, ADMIN, () =>
      one<{ id: string }>(
        `insert into public.menu_import_jobs (store_id, kind) values ($1, 'import_url') returning id`,
        [storeId],
      ),
    )).id;
    await as(db, ADMIN, () => db.query(`update public.menu_import_jobs set status = 'ready' where id = $1`, [job2]));
    const more = {
      store: {},
      option_groups: [{ name: "SIZE", selection: "single", min_select: 0, max_select: null, options: [{ name: "Huge", price_delta_centavos: 9900 }] }],
      categories: [{ name: "coffee", items: [{ name: "Mocha", description: "", base_price_centavos: 17000, option_groups: ["size"] }] }],
    };
    await as(db, ADMIN, () => db.query(`select public.apply_menu_import($1, $2)`, [job2, JSON.stringify(more)]));
    const cats = await db.query(`select 1 from public.menu_categories where store_id = $1`, [storeId]);
    expect(cats.rows).toHaveLength(2);
    const groups = await db.query(`select 1 from public.option_groups where store_id = $1`, [storeId]);
    expect(groups.rows).toHaveLength(1);
    const huge = await db.query(`select 1 from public.options where name = 'Huge'`);
    expect(huge.rows).toHaveLength(0); // existing group is not modified
  });

  it("a bad draft rolls back completely", async () => {
    const job3 = (await as(db, ADMIN, () =>
      one<{ id: string }>(`insert into public.menu_import_jobs (kind) values ('add_store') returning id`),
    )).id;
    await as(db, ADMIN, () => db.query(`update public.menu_import_jobs set status = 'ready' where id = $1`, [job3]));
    const bad = { store: { name: "Broken" }, option_groups: [], categories: [{ name: "X", items: [{ name: "Y", base_price_centavos: -5 }] }] };
    await expect(
      as(db, ADMIN, () => db.query(`select public.apply_menu_import($1, $2)`, [job3, JSON.stringify(bad)])),
    ).rejects.toThrow(/check constraint/);
    const s = await db.query(`select 1 from public.stores where name = 'Broken'`);
    expect(s.rows).toHaveLength(0);
  });

  it("regular users cannot apply imports", async () => {
    await expect(
      as(db, USER, () => db.query(`select public.apply_menu_import($1, $2)`, [jobId, JSON.stringify(draft)])),
    ).rejects.toThrow(/Import not found/);
  });
});

describe("menu reports", () => {
  let publishedStore: string;
  let draftStore: string;
  let itemId: string;

  beforeAll(async () => {
    await as(db, ADMIN, async () => {
      publishedStore = (await one<{ id: string }>(`insert into public.stores (name, status) values ('Pub', 'published') returning id`)).id;
      draftStore = (await one<{ id: string }>(`insert into public.stores (name) values ('Draft') returning id`)).id;
      const c = await one<{ id: string }>(`insert into public.menu_categories (store_id, name) values ($1, 'C') returning id`, [publishedStore]);
      itemId = (await one<{ id: string }>(
        `insert into public.menu_items (store_id, category_id, name, base_price_centavos) values ($1, $2, 'Item', 100) returning id`,
        [publishedStore, c.id],
      )).id;
    });
  });

  it("anyone signed in (guests too) can report an item on a published store", async () => {
    for (const who of [USER, GUEST]) {
      await as(db, who, () =>
        db.query(`insert into public.menu_reports (store_id, menu_item_id, kind, note) values ($1, $2, 'wrong_price', 'Now ₱150')`, [
          publishedStore,
          itemId,
        ]),
      );
    }
  });

  it("reports on draft stores, or with an item from another store, are rejected", async () => {
    await expect(
      as(db, USER, () => db.query(`insert into public.menu_reports (store_id, kind) values ($1, 'other')`, [draftStore])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(db, USER, () =>
        db.query(`insert into public.menu_reports (store_id, menu_item_id, kind) values ($1, $2, 'other')`, [draftStore, itemId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("reporters see only their own reports; admins see and resolve all", async () => {
    const mine = await as(db, USER, () => db.query(`select 1 from public.menu_reports`));
    expect(mine.rows).toHaveLength(1);
    const upd = await as(db, USER, () => db.query(`update public.menu_reports set status = 'resolved' returning id`));
    expect(upd.rows).toHaveLength(0);
    const all = await as(db, ADMIN, () =>
      db.query(`update public.menu_reports set status = 'resolved', resolved_at = now() returning id`),
    );
    expect(all.rows).toHaveLength(2);
  });
});
