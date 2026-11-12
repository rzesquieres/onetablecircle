import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000f001";
const ADMIN2 = "00000000-0000-0000-0000-00000000f002";
const HOST = "00000000-0000-0000-0000-00000000f003";
const DINER = "00000000-0000-0000-0000-00000000f004";
const OTHER = "00000000-0000-0000-0000-00000000f005";
const GUEST = "00000000-0000-0000-0000-00000000f006";

let db: PGlite;
let sessionId: string;

interface Row {
  user_id: string;
  email: string;
  display_name: string;
  removed_at: string | null;
  active_tables: number;
  hosting_tables: number;
  unpaid_bills: number;
}

const listUsers = (who: string) =>
  as(db, who, async () => (await db.query<Row>(`select * from public.admin_list_users()`)).rows);
const remove = (who: string, target: string, reason = "") =>
  as(db, who, () => db.query(`select public.admin_remove_user($1, $2)`, [target, reason]));

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email, is_anonymous, raw_user_meta_data) values
       ($1, 'admin@example.com', false, '{"name":"Ad Min"}'),
       ($2, 'admin2@example.com', false, '{}'),
       ($3, 'host@example.com', false, '{"name":"Hosty"}'),
       ($4, 'diner@example.com', false, '{"name":"Dina"}'),
       ($5, 'other@example.com', false, '{}'),
       ($6, null, true, '{}')`,
    [ADMIN, ADMIN2, HOST, DINER, OTHER, GUEST],
  );
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
  await db.query(`insert into public.beta_testers (email) values ('diner@example.com')`);

  // Hosty hosts a table that Dina joins; the bill is sent and Dina hasn't paid.
  const s = await db.query<{ id: string }>(
    `insert into public.sessions (host_id, title) values ($1, 'Dinner') returning id`,
    [HOST],
  );
  sessionId = s.rows[0].id;
  const code = (await db.query<{ join_code: string }>(`select join_code from public.sessions where id = $1`, [sessionId]))
    .rows[0].join_code;
  await as(db, DINER, () => db.query(`select public.join_session($1)`, [code]));
  await db.query(
    `insert into public.bill_shares (session_id, participant_id, items_centavos, service_centavos, tax_centavos,
       discount_centavos, tip_centavos, total_centavos)
     select $1, id, 50000, 5000, 0, 0, 0, 55000 from public.participants where session_id = $1 and user_id = $2`,
    [sessionId, DINER],
  );
  await db.query(`update public.sessions set status = 'billing' where id = $1`, [sessionId]);

  // Two logins for Dina.
  const sess = await db.query<{ id: string }>(
    `insert into auth.sessions (user_id) values ($1), ($1) returning id`,
    [DINER],
  );
  await db.query(`insert into auth.refresh_tokens (user_id, session_id) values ($1, $2), ($1, $3)`, [
    DINER,
    sess.rows[0].id,
    sess.rows[1].id,
  ]);
}, 60_000);

describe("admin_list_users", () => {
  it("is for admins only", async () => {
    await expect(listUsers(DINER)).rejects.toThrow(/Admins only/);
  });

  it("lists accounts (not quick guests) with what removal would affect", async () => {
    const rows = await listUsers(ADMIN);
    expect(rows.map((r) => r.user_id)).not.toContain(GUEST);
    const dina = rows.find((r) => r.user_id === DINER)!;
    expect(dina).toMatchObject({ email: "diner@example.com", active_tables: 1, hosting_tables: 0, unpaid_bills: 1 });
    const host = rows.find((r) => r.user_id === HOST)!;
    expect(host).toMatchObject({ active_tables: 1, hosting_tables: 1 });
  });
});

describe("admin_remove_user", () => {
  it("can't be used by non-admins", async () => {
    await expect(remove(OTHER, DINER)).rejects.toThrow(/Admins only/);
  });

  it("won't let an admin remove themselves", async () => {
    await expect(remove(ADMIN, ADMIN)).rejects.toThrow(/your own account/);
  });

  it("can remove another admin, who loses admin rights", async () => {
    await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN2]);
    await remove(ADMIN, ADMIN2, "Test cleanup");
    const p = await db.query<{ is_platform_admin: boolean }>(
      `select is_platform_admin from public.profiles where user_id = $1`,
      [ADMIN2],
    );
    expect(p.rows[0].is_platform_admin).toBe(false);
    await expect(listUsers(ADMIN2)).rejects.toThrow(/Admins only/);
  });

  it("removes a user without changing anyone's bill", async () => {
    const before = await db.query(`select * from public.bill_shares where session_id = $1`, [sessionId]);
    await remove(ADMIN, DINER, "Asked to be removed");

    const profile = await db.query<{ display_name: string; removed_at: string | null }>(
      `select display_name, removed_at from public.profiles where user_id = $1`,
      [DINER],
    );
    expect(profile.rows[0].display_name).toBe("Removed user");
    expect(profile.rows[0].removed_at).not.toBeNull();

    const atTable = await db.query<{ display_name: string }>(
      `select display_name from public.participants where user_id = $1`,
      [DINER],
    );
    expect(atTable.rows).toEqual([{ display_name: "Removed user" }]);

    const after = await db.query(`select * from public.bill_shares where session_id = $1`, [sessionId]);
    expect(after.rows).toEqual(before.rows);
  });

  it("blocks sign-in and ends every login", async () => {
    const u = await db.query<{ banned_until: Date | null }>(`select banned_until from auth.users where id = $1`, [DINER]);
    expect(u.rows[0].banned_until!.getUTCFullYear()).toBe(2999);
    expect((await db.query(`select 1 from auth.sessions where user_id = $1`, [DINER])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from auth.refresh_tokens where user_id = $1`, [DINER])).rows).toHaveLength(0);
  });

  it("takes them off the testers list and stops them hosting", async () => {
    expect((await db.query(`select 1 from public.beta_testers where email = 'diner@example.com'`)).rows).toHaveLength(0);
    const r = await as(db, DINER, () => db.query<{ ok: boolean }>(`select public.can_host() as ok`));
    expect(r.rows[0].ok).toBe(false);
  });

  it("logs who removed whom, and only admins can read the log", async () => {
    const log = await as(db, ADMIN, () =>
      db.query<{ email: string; display_name: string; reason: string; removed_by: string }>(
        `select email, display_name, reason, removed_by from public.user_removals where user_id = $1`,
        [DINER],
      ),
    );
    expect(log.rows).toEqual([
      { email: "diner@example.com", display_name: "Dina", reason: "Asked to be removed", removed_by: ADMIN },
    ]);
    expect((await as(db, OTHER, () => db.query(`select 1 from public.user_removals`))).rows).toHaveLength(0);
  });

  it("refuses to remove someone twice, or a user who doesn't exist", async () => {
    await expect(remove(ADMIN, DINER)).rejects.toThrow(/already been removed/);
    await expect(remove(ADMIN, "00000000-0000-0000-0000-00000000ffff")).rejects.toThrow(/not found/);
  });

  it("can't be changed by users editing their own profile", async () => {
    await expect(
      as(db, OTHER, () => db.query(`update public.profiles set removed_at = now() where user_id = $1`, [OTHER])),
    ).rejects.toThrow(/permission denied/);
  });

  it("shows removed users last in the admin list", async () => {
    const rows = await listUsers(ADMIN);
    expect(rows.at(-1)!.removed_at).not.toBeNull();
  });
});
