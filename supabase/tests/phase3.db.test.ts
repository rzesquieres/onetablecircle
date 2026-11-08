import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000ad01";
const HOST = "00000000-0000-0000-0000-00000000a002";
const FRIEND = "00000000-0000-0000-0000-00000000a003";
const OWNER = "00000000-0000-0000-0000-00000000a004";
const GUEST = { id: "00000000-0000-0000-0000-00000000a005", anonymous: true };
const OWNER_ORG = "00000000-0000-0000-0000-0000000000f1";

let db: PGlite;
const ids: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'admin@example.com', '{"full_name":"Admin"}'),
       ($2, 'host@example.com', '{"full_name":"Host"}'),
       ($3, 'friend@example.com', '{}'),
       ($4, 'owner@example.com', '{}'),
       ($5, null, '{}')`,
    [ADMIN, HOST, FRIEND, OWNER, GUEST.id],
  );
  // Made admin by an operator (users can never set this themselves).
  await db.query("update public.profiles set is_platform_admin = true where user_id = $1", [ADMIN]);
  await db.query(`insert into public.organizations (id, name) values ($1, 'Kapihan Inc.')`, [OWNER_ORG]);
  await db.query(`insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [OWNER_ORG, OWNER]);
}, 60_000);

describe("admin builds a menu", () => {
  it("creates a store with a category, items, option groups and options", async () => {
    await as(db, ADMIN, async () => {
      ids.store = (await one<{ id: string }>(
        `insert into public.stores (name, branch) values ('Starbucks', 'BGC') returning id`,
      )).id;
      ids.drinks = (await one<{ id: string }>(
        `insert into public.menu_categories (store_id, name) values ($1, 'Drinks') returning id`,
        [ids.store],
      )).id;
      ids.latte = (await one<{ id: string }>(
        `insert into public.menu_items (store_id, category_id, name, base_price_centavos)
         values ($1, $2, 'Iced latte', 16000) returning id`,
        [ids.store, ids.drinks],
      )).id;
      ids.cake = (await one<{ id: string }>(
        `insert into public.menu_items (store_id, category_id, name, base_price_centavos, price_status, is_available)
         values ($1, $2, 'Cake slice', 15000, 'estimated', true) returning id`,
        [ids.store, ids.drinks],
      )).id;
      ids.size = (await one<{ id: string }>(
        `insert into public.option_groups (store_id, name, selection, min_select) values ($1, 'Size', 'single', 1) returning id`,
        [ids.store],
      )).id;
      ids.addons = (await one<{ id: string }>(
        `insert into public.option_groups (store_id, name, selection, max_select) values ($1, 'Add-ons', 'multi', 2) returning id`,
        [ids.store],
      )).id;
      const opt = async (group: string, name: string, delta: number) =>
        (await one<{ id: string }>(
          `insert into public.options (store_id, option_group_id, name, price_delta_centavos) values ($1, $2, $3, $4) returning id`,
          [ids.store, group, name, delta],
        )).id;
      ids.tall = await opt(ids.size, "Tall", 0);
      ids.grande = await opt(ids.size, "Grande", 2000);
      ids.oat = await opt(ids.addons, "Oat milk", 3000);
      ids.shot = await opt(ids.addons, "Extra shot", 4000);
      ids.syrup = await opt(ids.addons, "Syrup", 2500);
      await db.query(
        `insert into public.menu_item_option_groups (menu_item_id, option_group_id, store_id, sort_order)
         values ($1, $2, $3, 0), ($1, $4, $3, 1)`,
        [ids.latte, ids.size, ids.store, ids.addons],
      );
    });
  });

  it("an option group from another store cannot be attached", async () => {
    const other = await as(db, ADMIN, () =>
      one<{ id: string }>(`insert into public.stores (name) values ('Other') returning id`),
    );
    const g = await as(db, ADMIN, () =>
      one<{ id: string }>(`insert into public.option_groups (store_id, name) values ($1, 'Milk') returning id`, [other.id]),
    );
    await expect(
      as(db, ADMIN, () =>
        db.query(
          `insert into public.menu_item_option_groups (menu_item_id, option_group_id, store_id) values ($1, $2, $3)`,
          [ids.latte, g.id, ids.store],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("regular users cannot create stores or edit menus", async () => {
    await expect(
      as(db, HOST, () => db.query(`insert into public.stores (name) values ('Fake')`)),
    ).rejects.toThrow(/row-level security/);
    const upd = await as(db, HOST, () =>
      db.query(`update public.menu_items set base_price_centavos = 1 where id = $1 returning id`, [ids.latte]),
    );
    expect(upd.rows).toHaveLength(0);
    await expect(
      as(db, HOST, () => db.query(`update public.profiles set is_platform_admin = true`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("draft vs published", () => {
  it("drafts are hidden from regular users and guests", async () => {
    for (const who of [HOST, GUEST]) {
      const r = await as(db, who, () => db.query(`select 1 from public.menu_items where store_id = $1`, [ids.store]));
      expect(r.rows).toHaveLength(0);
    }
  });

  it("a host cannot start a table at a draft store", async () => {
    await expect(
      as(db, HOST, () =>
        db.query(`insert into public.sessions (host_id, title, store_id) values ($1, 'x', $2)`, [HOST, ids.store]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("once published, everyone signed in (guests too) can read the menu", async () => {
    const before = await one<{ menu_updated_at: string }>(`select menu_updated_at from public.stores where id = $1`, [ids.store]);
    await as(db, ADMIN, () => db.query(`update public.stores set status = 'published' where id = $1`, [ids.store]));
    for (const who of [HOST, GUEST]) {
      const r = await as(db, who, () => db.query(`select 1 from public.options where store_id = $1`, [ids.store]));
      expect(r.rows).toHaveLength(5);
    }
    await as(db, ADMIN, () => db.query(`update public.menu_items set description = 'Espresso and milk' where id = $1`, [ids.latte]));
    const after = await one<{ menu_updated_at: string }>(`select menu_updated_at from public.stores where id = $1`, [ids.store]);
    expect(new Date(after.menu_updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.menu_updated_at).getTime());
  });
});

describe("ordering from the menu", () => {
  let hostPid: string;
  let friendPid: string;

  beforeAll(async () => {
    const s = await as(db, HOST, () =>
      one<{ id: string; join_code: string }>(
        `insert into public.sessions (host_id, title, store_id) values ($1, 'Coffee', $2) returning id, join_code`,
        [HOST, ids.store],
      ),
    );
    ids.session = s.id;
    await as(db, FRIEND, () => db.query(`select public.join_session($1)`, [s.join_code]));
    const p = await as(db, HOST, () =>
      db.query<{ id: string; user_id: string }>(`select id, user_id from public.participants where session_id = $1`, [s.id]),
    );
    hostPid = p.rows.find((r) => r.user_id === HOST)!.id;
    friendPid = p.rows.find((r) => r.user_id === FRIEND)!.id;
  });

  const add = (who: string, item: string, options: string[], extra: Partial<{ qty: number; shared: boolean; people: string[] }> = {}) =>
    as(db, who, () =>
      one<{ id: string }>(`select public.add_menu_item($1, $2, $3, $4, '', $5, $6) as id`, [
        ids.session,
        item,
        options,
        extra.qty ?? 1,
        extra.shared ?? false,
        extra.people ?? [friendPid],
      ]),
    );

  it("works out the price from the menu and snapshots the options", async () => {
    const r = await add(FRIEND, ids.latte, [ids.grande, ids.oat, ids.shot], { qty: 2 });
    const row = await as(db, FRIEND, () =>
      one<{ name: string; unit_price_centavos: string; quantity: number; options: unknown; price_is_estimate: boolean }>(
        `select name, unit_price_centavos, quantity, options, price_is_estimate from public.order_items where id = $1`,
        [r.id],
      ),
    );
    expect(row.name).toBe("Iced latte");
    expect(Number(row.unit_price_centavos)).toBe(16000 + 2000 + 3000 + 4000);
    expect(row.quantity).toBe(2);
    expect(row.price_is_estimate).toBe(false);
    expect(row.options).toEqual([
      { group: "Size", option: "Grande", price_delta_centavos: 2000 },
      { group: "Add-ons", option: "Extra shot", price_delta_centavos: 4000 },
      { group: "Add-ons", option: "Oat milk", price_delta_centavos: 3000 },
    ]);
  });

  it("enforces required and maximum choices", async () => {
    await expect(add(FRIEND, ids.latte, [])).rejects.toThrow(/choose size/);
    await expect(add(FRIEND, ids.latte, [ids.tall, ids.grande])).rejects.toThrow(/Too many choices for size/);
    await expect(add(FRIEND, ids.latte, [ids.tall, ids.oat, ids.shot, ids.syrup])).rejects.toThrow(/Too many choices for add-ons/);
  });

  it("rejects options that don't belong to the item", async () => {
    await expect(add(FRIEND, ids.cake, [ids.grande])).rejects.toThrow(/does not apply/);
  });

  it("marks estimated prices and rejects unavailable items", async () => {
    const r = await add(HOST, ids.cake, [], { shared: true, people: [hostPid, friendPid] });
    const row = await as(db, HOST, () =>
      one<{ price_is_estimate: boolean }>(`select price_is_estimate from public.order_items where id = $1`, [r.id]),
    );
    expect(row.price_is_estimate).toBe(true);
    await as(db, ADMIN, () => db.query(`update public.menu_items set is_available = false where id = $1`, [ids.cake]));
    await expect(add(HOST, ids.cake, [])).rejects.toThrow(/not available/);
  });

  it("phones cannot set prices or menu snapshots directly", async () => {
    await expect(
      as(db, FRIEND, () =>
        db.query(
          `insert into public.order_items (session_id, added_by, name, unit_price_centavos, menu_item_id)
           values ($1, $2, 'Iced latte', 1, $3)`,
          [ids.session, friendPid, ids.latte],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("people outside the table cannot order", async () => {
    await expect(
      as(db, GUEST, () =>
        db.query(`select public.add_menu_item($1, $2, $3, 1, '', false, $4)`, [ids.session, ids.latte, [ids.tall], [friendPid]]),
      ),
    ).rejects.toThrow(/not part of this table/);
  });

  it("deleting a menu item keeps past orders (name and price snapshot)", async () => {
    const r = await add(FRIEND, ids.latte, [ids.tall]);
    await as(db, ADMIN, () => db.query(`delete from public.menu_items where id = $1`, [ids.latte]));
    const row = await as(db, FRIEND, () =>
      one<{ name: string; menu_item_id: string | null; unit_price_centavos: string }>(
        `select name, menu_item_id, unit_price_centavos from public.order_items where id = $1`,
        [r.id],
      ),
    );
    expect({ ...row, unit_price_centavos: Number(row.unit_price_centavos) }).toEqual({
      name: "Iced latte",
      menu_item_id: null,
      unit_price_centavos: 16000,
    });
  });
});

describe("store owners (multi-tenant)", () => {
  it("can create and edit stores in their own organization only", async () => {
    const s = await as(db, OWNER, () =>
      one<{ id: string }>(`insert into public.stores (org_id, name) values ($1, 'Kapihan') returning id`, [OWNER_ORG]),
    );
    const upd = await as(db, OWNER, () =>
      db.query(`update public.stores set branch = 'Makati' where id = $1 returning id`, [s.id]),
    );
    expect(upd.rows).toHaveLength(1);
    const notMine = await as(db, OWNER, () =>
      db.query(`update public.stores set branch = 'x' where id = $1 returning id`, [ids.store]),
    );
    expect(notMine.rows).toHaveLength(0);
    await expect(
      as(db, OWNER, () => db.query(`insert into public.stores (name) values ('Into platform org')`)),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("menu photos", () => {
  it("editors can upload into their store's folder; others cannot", async () => {
    await as(db, ADMIN, () =>
      db.query(`insert into storage.objects (bucket_id, name) values ('menu-photos', $1)`, [`${ids.store}/latte.jpg`]),
    );
    await expect(
      as(db, HOST, () =>
        db.query(`insert into storage.objects (bucket_id, name) values ('menu-photos', $1)`, [`${ids.store}/x.jpg`]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(db, ADMIN, () => db.query(`insert into storage.objects (bucket_id, name) values ('menu-photos', 'not-a-uuid/x.jpg')`)),
    ).rejects.toThrow(/row-level security/);
  });
});
