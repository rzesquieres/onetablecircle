import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000cd01";
const USER = "00000000-0000-0000-0000-00000000c002";

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

/** A "ready" import job, as the AI route leaves it. */
async function readyJob(kind: "add_store" | "import_url", storeId: string | null = null): Promise<string> {
  const { id } = await as(db, ADMIN, () =>
    one<{ id: string }>(
      `insert into public.menu_import_jobs (store_id, kind, input) values ($1, $2, '{"name":"Kape Ni Juan"}') returning id`,
      [storeId, kind],
    ),
  );
  await as(db, ADMIN, () =>
    db.query(`update public.menu_import_jobs set status = 'ready', result = '{"sources":[]}' where id = $1`, [id]),
  );
  return id;
}

const apply = (job: string, menu: unknown, target: string | null = null, mode = "merge") =>
  as(db, ADMIN, () =>
    one<{ s: Record<string, unknown> }>(`select public.apply_menu_import_v2($1, $2, $3, $4) as s`, [
      job,
      JSON.stringify(menu),
      target,
      mode,
    ]),
  ).then((r) => r.s);

const items = (storeId: string) =>
  db
    .query<{ name: string; category: string; price: string; status: string; description: string; available: boolean }>(
      `select i.name, c.name as category, i.base_price_centavos::text as price, i.price_status::text as status,
              i.description, i.is_available as available
       from public.menu_items i join public.menu_categories c on c.id = i.category_id
       where i.store_id = $1 order by i.name`,
      [storeId],
    )
    .then((r) => r.rows);

const firstMenu = {
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
        { name: "Spanish Latte", description: "Sweet", base_price_centavos: 16500, option_groups: ["Size"] },
        { name: "Americano", description: "", base_price_centavos: 12000, option_groups: [] },
      ],
    },
    { name: "Pastries", items: [{ name: "Ensaymada", description: "Buttery", base_price_centavos: 9000, option_groups: [] }] },
  ],
};

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com'), ($2, 'user@example.com')`, [ADMIN, USER]);
  await db.query("update public.profiles set is_platform_admin = true where user_id = $1", [ADMIN]);
}, 60_000);

describe("apply_menu_import_v2", () => {
  let storeId: string;
  let latteId: string;
  let orderItemId: string;

  it("an AI add store job with no target creates a new draft store", async () => {
    const s = await apply(await readyJob("add_store"), firstMenu);
    expect(s).toMatchObject({ created_store: true, mode: "new", added: 3, updated: 0, hidden: 0 });
    storeId = s.store_id as string;
    const store = await one(`select name, branch, status::text from public.stores where id = $1`, [storeId]);
    expect(store).toEqual({ name: "Kape Ni Juan", branch: "Makati", status: "draft" });
    expect(await items(storeId)).toHaveLength(3);
    latteId = (await one<{ id: string }>(`select id from public.menu_items where name = 'Spanish Latte'`)).id;
  });

  it("an AI add store job can update an existing store instead (merge)", async () => {
    // Confirm the Americano price and record a past order of the latte.
    await db.query(`update public.menu_items set price_status = 'confirmed' where store_id = $1`, [storeId]);
    const session = await one<{ id: string }>(`insert into public.sessions (host_id, title) values ($1, 'Lunch') returning id`, [ADMIN]);
    const pid = await one<{ id: string }>(
      `insert into public.participants (session_id, display_name) values ($1, 'Ana') returning id`,
      [session.id],
    );
    orderItemId = (await one<{ id: string }>(
      `insert into public.order_items (session_id, added_by, name, unit_price_centavos, menu_item_id)
       values ($1, $2, 'Spanish Latte', 16500, $3) returning id`,
      [session.id, pid.id, latteId],
    )).id;

    const update = {
      store: { name: "Ignored when updating", branch: "", source_url: "" },
      option_groups: [
        {
          name: "size",
          selection: "single",
          min_select: 1,
          max_select: null,
          options: [
            { name: "large", price_delta_centavos: 3500 },
            { name: "Venti", price_delta_centavos: 5000 },
          ],
        },
      ],
      categories: [
        {
          name: "coffee",
          items: [
            { name: "  spanish   latte ", description: "", base_price_centavos: 17500, option_groups: ["SIZE"] },
            { name: "Americano", description: "Black", base_price_centavos: 12000, option_groups: ["Size"] },
            { name: "Mocha", description: "", base_price_centavos: 18000, option_groups: [] },
          ],
        },
      ],
    };
    const s = await apply(await readyJob("add_store"), update, storeId, "merge");
    expect(s).toMatchObject({ store_id: storeId, created_store: false, mode: "merge", added: 1, updated: 2, hidden: 0 });

    expect(await items(storeId)).toEqual([
      // Same price stays confirmed; new description replaces the empty one.
      { name: "Americano", category: "Coffee", price: "12000", status: "confirmed", description: "Black", available: true },
      // Missing from the upload: left alone.
      { name: "Ensaymada", category: "Pastries", price: "9000", status: "confirmed", description: "Buttery", available: true },
      { name: "Mocha", category: "Coffee", price: "18000", status: "estimated", description: "", available: true },
      // Price changed -> estimated; empty description keeps the old one; no duplicate row.
      { name: "spanish latte", category: "Coffee", price: "17500", status: "estimated", description: "Sweet", available: true },
    ]);
    const store = await one<{ name: string }>(`select name from public.stores where id = $1`, [storeId]);
    expect(store.name).toBe("Kape Ni Juan");

    // Options: Large updated, Venti added, still one Size group.
    const opts = await db.query<{ name: string; price: string }>(
      `select o.name, o.price_delta_centavos::text as price from public.options o where o.store_id = $1 order by o.sort_order`,
      [storeId],
    );
    expect(opts.rows).toEqual([
      { name: "Regular", price: "0" },
      { name: "Large", price: "3500" },
      { name: "Venti", price: "5000" },
    ]);
    const groups = await db.query(`select 1 from public.option_groups where store_id = $1`, [storeId]);
    expect(groups.rows).toHaveLength(1);
    const links = await db.query(
      `select 1 from public.menu_item_option_groups l join public.menu_items i on i.id = l.menu_item_id where i.name = 'Americano'`,
    );
    expect(links.rows).toHaveLength(1);
  });

  it("past orders keep their link and their price snapshot", async () => {
    const o = await one(`select menu_item_id, unit_price_centavos::text as price from public.order_items where id = $1`, [orderItemId]);
    expect(o).toEqual({ menu_item_id: latteId, price: "16500" });
  });

  it("an item can move to another category", async () => {
    const s = await apply(
      await readyJob("import_url", storeId),
      { store: {}, option_groups: [], categories: [{ name: "Bread", items: [{ name: "Ensaymada", description: "", base_price_centavos: 9000, option_groups: [] }] }] },
    );
    expect(s).toMatchObject({ added: 0, updated: 1 });
    const e = (await items(storeId)).find((i) => i.name === "Ensaymada");
    expect(e?.category).toBe("Bread");
  });

  it("replace hides items missing from the upload instead of deleting them", async () => {
    await db.query(`update public.menu_items set is_available = false where name = 'Mocha'`);
    const s = await apply(
      await readyJob("import_url", storeId),
      {
        store: {},
        option_groups: [],
        categories: [
          {
            name: "Coffee",
            items: [
              { name: "Mocha", description: "", base_price_centavos: 18000, option_groups: [] },
              { name: "Flat white", description: "", base_price_centavos: 17000, option_groups: [] },
            ],
          },
        ],
      },
      null,
      "replace",
    );
    expect(s).toMatchObject({ mode: "replace", added: 1, updated: 1, hidden: 3 });
    const rows = await items(storeId);
    expect(rows.filter((r) => r.available).map((r) => r.name).sort()).toEqual(["Flat white", "Mocha"]);
    expect(rows).toHaveLength(5);
    const o = await one<{ menu_item_id: string }>(`select menu_item_id from public.order_items where id = $1`, [orderItemId]);
    expect(o.menu_item_id).toBe(latteId);
  });

  it("the same name twice in one upload adds a second item rather than updating one twice", async () => {
    const s = await apply(
      await readyJob("import_url", storeId),
      {
        store: {},
        option_groups: [],
        categories: [
          { name: "Coffee", items: [{ name: "Americano", description: "", base_price_centavos: 12000, option_groups: [] }] },
          { name: "Iced", items: [{ name: "Americano", description: "", base_price_centavos: 13000, option_groups: [] }] },
        ],
      },
    );
    expect(s).toMatchObject({ added: 1, updated: 1 });
  });

  it("saves the summary on the job", async () => {
    const job = await readyJob("import_url", storeId);
    await apply(job, { store: {}, option_groups: [], categories: [] });
    const j = await one<{ status: string; summary: { updated: number } }>(
      `select status::text, result -> 'applied_summary' as summary from public.menu_import_jobs where id = $1`,
      [job],
    );
    expect(j.status).toBe("applied");
    expect(j.summary).toMatchObject({ store_id: storeId, added: 0, updated: 0 });
  });

  it("rejects a different target for an import that belongs to a store", async () => {
    const other = await as(db, ADMIN, () => one<{ id: string }>(`insert into public.stores (name) values ('Other') returning id`));
    const job = await readyJob("import_url", storeId);
    await expect(apply(job, firstMenu, other.id)).rejects.toThrow(/another store/);
  });

  it("rejects an unknown store or mode", async () => {
    await expect(apply(await readyJob("add_store"), firstMenu, "00000000-0000-0000-0000-000000000999")).rejects.toThrow(/Store not found/);
    await expect(apply(await readyJob("add_store"), firstMenu, storeId, "wipe")).rejects.toThrow(/Unknown import mode/);
  });

  it("regular users cannot apply imports", async () => {
    const job = await readyJob("add_store");
    await expect(
      as(db, USER, () => db.query(`select public.apply_menu_import_v2($1, $2, $3, 'merge')`, [job, JSON.stringify(firstMenu), storeId])),
    ).rejects.toThrow(/Import not found/);
  });
});
