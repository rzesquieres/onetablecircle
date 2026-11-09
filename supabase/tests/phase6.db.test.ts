import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

const ME = "00000000-0000-0000-0000-00000000d001";
const FRIEND = "00000000-0000-0000-0000-00000000d002";
const STRANGER = "00000000-0000-0000-0000-00000000d003";
const ADMIN = "00000000-0000-0000-0000-00000000d004";
const GUEST = { id: "00000000-0000-0000-0000-00000000d005", anonymous: true };

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
       ($1, 'me@x', '{"full_name":"Me"}', false), ($2, 'f@x', '{"full_name":"Friend"}', false),
       ($3, 's@x', '{}', false), ($4, 'a@x', '{}', false), ($5, null, '{}', true)`,
    [ME, FRIEND, STRANGER, ADMIN, GUEST.id],
  );
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
  // Me and Friend shared a table once.
  const s = await as(db, ME, () =>
    one<{ join_code: string }>(`insert into public.sessions (host_id, title) values ($1, 'Last week') returning join_code`, [ME]),
  );
  await as(db, FRIEND, () => db.query(`select public.join_session($1)`, [s.join_code]));
}, 60_000);

describe("saved groups", () => {
  let groupId: string;

  it("you can save people you've shared a table with, plus plain names", async () => {
    groupId = (await as(db, ME, () => one<{ id: string }>(`insert into public.saved_groups (name) values ('Family') returning id`))).id;
    await as(db, ME, () =>
      db.query(
        `insert into public.saved_group_members (group_id, user_id, display_name, sort_order)
         values ($1, $2, 'Friend', 0), ($1, null, 'Lola', 1)`,
        [groupId, FRIEND],
      ),
    );
  });

  it("but not strangers' accounts", async () => {
    await expect(
      as(db, ME, () =>
        db.query(`insert into public.saved_group_members (group_id, user_id, display_name) values ($1, $2, 'S')`, [groupId, STRANGER]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("groups are private; guests can't make them", async () => {
    expect((await as(db, FRIEND, () => db.query(`select 1 from public.saved_groups`))).rows).toHaveLength(0);
    expect((await as(db, FRIEND, () => db.query(`select 1 from public.saved_group_members`))).rows).toHaveLength(0);
    await expect(as(db, GUEST, () => db.query(`insert into public.saved_groups (name) values ('x')`))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("adding a group to a new table brings everyone in, once", async () => {
    const t = await as(db, ME, () =>
      one<{ id: string }>(`insert into public.sessions (host_id, title) values ($1, 'Sunday lunch') returning id`, [ME]),
    );
    const added = await as(db, ME, () =>
      one<{ n: number }>(`select public.add_saved_group_to_session($1, $2) as n`, [t.id, groupId]),
    );
    expect(added.n).toBe(2);
    const again = await as(db, ME, () =>
      one<{ n: number }>(`select public.add_saved_group_to_session($1, $2) as n`, [t.id, groupId]),
    );
    expect(again.n).toBe(0);
    const people = await as(db, ME, () =>
      db.query<{ display_name: string; has_account: boolean }>(
        `select display_name, user_id is not null as has_account from public.participants where session_id = $1 order by display_name`,
        [t.id],
      ),
    );
    expect(people.rows).toEqual([
      { display_name: "Friend", has_account: true },
      { display_name: "Lola", has_account: false },
      { display_name: "Me", has_account: true },
    ]);
    // The friend now sees the table.
    expect((await as(db, FRIEND, () => db.query(`select 1 from public.sessions where id = $1`, [t.id]))).rows).toHaveLength(1);
  });

  it("only the host can add a group, and only their own group", async () => {
    const t = await as(db, FRIEND, () =>
      one<{ id: string }>(`insert into public.sessions (host_id, title) values ($1, 'F table') returning id`, [FRIEND]),
    );
    await expect(
      as(db, FRIEND, () => db.query(`select public.add_saved_group_to_session($1, $2)`, [t.id, groupId])),
    ).rejects.toThrow(/Group not found/);
    await expect(
      as(db, ME, () => db.query(`select public.add_saved_group_to_session($1, $2)`, [t.id, groupId])),
    ).rejects.toThrow(/Only the host/);
  });
});

describe("favorites", () => {
  let storeId: string;
  let itemId: string;

  beforeAll(async () => {
    await as(db, ADMIN, async () => {
      storeId = (await one<{ id: string }>(`insert into public.stores (name, status) values ('Cafe', 'published') returning id`)).id;
      const c = await one<{ id: string }>(`insert into public.menu_categories (store_id, name) values ($1, 'C') returning id`, [storeId]);
      itemId = (await one<{ id: string }>(
        `insert into public.menu_items (store_id, category_id, name, base_price_centavos) values ($1, $2, 'Latte', 100) returning id`,
        [storeId, c.id],
      )).id;
    });
  });

  it("are private to each person", async () => {
    await as(db, ME, () =>
      db.query(`insert into public.favorites (store_id, menu_item_id, notes) values ($1, $2, 'less ice')`, [storeId, itemId]),
    );
    expect((await as(db, ME, () => db.query(`select notes from public.favorites`))).rows).toEqual([{ notes: "less ice" }]);
    expect((await as(db, FRIEND, () => db.query(`select 1 from public.favorites`))).rows).toHaveLength(0);
  });

  it("must point at an item of that store", async () => {
    const other = await as(db, ADMIN, () =>
      one<{ id: string }>(`insert into public.stores (name, status) values ('Other', 'published') returning id`),
    );
    await expect(
      as(db, ME, () => db.query(`insert into public.favorites (store_id, menu_item_id) values ($1, $2)`, [other.id, itemId])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("admin analytics", () => {
  it("returns counts for admins only", async () => {
    const stats = await as(db, ADMIN, () => one<{ s: Record<string, unknown> }>(`select public.admin_stats() as s`));
    expect(stats.s).toMatchObject({ users_registered: 4, users_guest: 1, tables_7d: 3, stores_published: 2 });
    expect((stats.s.weekly as unknown[]).length).toBe(12);
    await expect(as(db, ME, () => db.query(`select public.admin_stats()`))).rejects.toThrow(/Admins only/);
  });
});
