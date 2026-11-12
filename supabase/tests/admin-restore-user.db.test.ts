import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asVisitor, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000e001";
const HOST = "00000000-0000-0000-0000-00000000e002";
const DINA = "00000000-0000-0000-0000-00000000e003"; // removed, email kept
const GOOG = "00000000-0000-0000-0000-00000000e004"; // removed with "let this email sign up again"
const TAKEN = "00000000-0000-0000-0000-00000000e005"; // removed, then someone signed up with the email
const NEWBIE = "00000000-0000-0000-0000-00000000e006"; // the new account using TAKEN's old email
const OLD = "00000000-0000-0000-0000-00000000e007"; // removed before OTC-18 (nothing saved)
const ADMIN2 = "00000000-0000-0000-0000-00000000e008";

let db: PGlite;
let sessionId: string;
let groupId: string;

interface Restored {
  email: string;
  display_name: string;
  needs_password_reset: boolean;
}

const remove = (target: string, allowSignup = false) =>
  as(db, ADMIN, () => db.query(`select public.admin_remove_user($1, '', $2)`, [target, allowSignup]));
const restore = (who: string, target: string, reason = "", addToTesters: boolean | null = null) =>
  as(db, who, async () =>
    (
      await db.query<Restored>(`select * from public.admin_restore_user($1, $2, $3)`, [target, reason, addToTesters])
    ).rows[0],
  );
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email, is_anonymous, raw_user_meta_data) values
       ($1, 'admin@example.com', false, '{"name":"Ad Min"}'),
       ($2, 'host@example.com', false, '{"name":"Hosty"}'),
       ($3, 'dina@example.com', false, '{"name":"Dina"}'),
       ($4, 'goog@example.com', false, '{"name":"Goog Le","avatar_url":"x"}'),
       ($5, 'taken@example.com', false, '{"name":"Tak En"}'),
       ($6, 'old@example.com', false, '{"name":"Old Timer"}'),
       ($7, 'admin2@example.com', false, '{"name":"Second"}')`,
    [ADMIN, HOST, DINA, GOOG, TAKEN, OLD, ADMIN2],
  );
  await db.query(`update public.profiles set is_platform_admin = true where user_id in ($1, $2)`, [ADMIN, ADMIN2]);
  await db.query(`insert into public.beta_testers (email) values ('dina@example.com'), ('goog@example.com')`);
  await db.query(
    `insert into auth.identities (user_id, provider, provider_id, identity_data) values
       ($1::uuid, 'email', $1::text, '{"email":"goog@example.com"}'),
       ($1::uuid, 'google', 'g-goog', '{"email":"goog@example.com"}'),
       ($2::uuid, 'google', 'g-taken', '{"email":"taken@example.com"}')`,
    [GOOG, TAKEN],
  );

  // Dina and Goog sit at Hosty's table under nicknames; Dina is in Hosty's saved group.
  sessionId = (await one<{ id: string }>(`insert into public.sessions (host_id, title) values ($1, 'Dinner') returning id`, [HOST])).id;
  const code = (await one<{ join_code: string }>(`select join_code from public.sessions where id = $1`, [sessionId])).join_code;
  for (const u of [DINA, GOOG, OLD]) await as(db, u, () => db.query(`select public.join_session($1)`, [code]));
  await db.query(`update public.participants set display_name = 'Dee' where user_id = $1`, [DINA]);
  await db.query(`update public.participants set display_name = 'G' where user_id = $1`, [GOOG]);
  await db.query(`update public.participants set display_name = 'Oldie' where user_id = $1`, [OLD]);
  groupId = (await as(db, HOST, () => one<{ id: string }>(`insert into public.saved_groups (name) values ('Barkada') returning id`))).id;
  await db.query(
    `insert into public.saved_group_members (group_id, user_id, display_name) values ($1, $2, 'Dina from work')`,
    [groupId, DINA],
  );
}, 60_000);

describe("admin_restore_user", () => {
  it("is for admins only, and not for visitors at all", async () => {
    await remove(DINA);
    await expect(restore(HOST, DINA)).rejects.toThrow(/Admins only/);
    await expect(
      asVisitor(db, () => db.query(`select public.admin_restore_user($1)`, [DINA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses users who aren't removed, or don't exist", async () => {
    await expect(restore(ADMIN, HOST)).rejects.toThrow(/isn't removed/);
    await expect(restore(ADMIN, "00000000-0000-0000-0000-00000000ffff")).rejects.toThrow(/not found/);
  });

  it("lifts the ban and brings back their names everywhere", async () => {
    const result = await restore(ADMIN, DINA, "Removed by mistake");
    expect(result).toEqual({ email: "dina@example.com", display_name: "Dina", needs_password_reset: false });

    const u = await one<{ banned_until: Date | null; email: string }>(
      `select banned_until, email from auth.users where id = $1`,
      [DINA],
    );
    expect(u).toEqual({ banned_until: null, email: "dina@example.com" });
    expect(await one(`select display_name, removed_at from public.profiles where user_id = $1`, [DINA])).toEqual({
      display_name: "Dina",
      removed_at: null,
    });
    expect(await one(`select display_name from public.participants where user_id = $1`, [DINA])).toEqual({
      display_name: "Dee",
    });
    expect(await one(`select display_name from public.saved_group_members where user_id = $1`, [DINA])).toEqual({
      display_name: "Dina from work",
    });
  });

  it("puts a former tester back on the testers list, and they can host again", async () => {
    expect((await db.query(`select 1 from public.beta_testers where email = 'dina@example.com'`)).rows).toHaveLength(1);
    await db.query("update public.app_config set invite_only = true");
    const r = await as(db, DINA, () => one<{ ok: boolean }>(`select public.can_host() as ok`));
    await db.query("update public.app_config set invite_only = false");
    expect(r.ok).toBe(true);
  });

  it("logs who restored whom, when and why", async () => {
    const log = await as(db, ADMIN, () =>
      one<{ restored_by: string; restore_reason: string; restored_at: string | null }>(
        `select restored_by, restore_reason, restored_at from public.user_removals where user_id = $1`,
        [DINA],
      ),
    );
    expect(log.restored_by).toBe(ADMIN);
    expect(log.restore_reason).toBe("Removed by mistake");
    expect(log.restored_at).not.toBeNull();
  });

  it("won't restore twice, but a second removal can be restored again", async () => {
    await expect(restore(ADMIN, DINA)).rejects.toThrow(/isn't removed/);
    await remove(DINA);
    await restore(ADMIN, DINA, "", false);
    expect(await one(`select display_name from public.participants where user_id = $1`, [DINA])).toEqual({
      display_name: "Dee",
    });
    // Admin chose not to add them back to the testers list this time.
    expect((await db.query(`select 1 from public.beta_testers where email = 'dina@example.com'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.user_removals where user_id = $1`, [DINA])).rows).toHaveLength(2);
  });

  it("doesn't give back admin rights", async () => {
    await remove(ADMIN2);
    await restore(ADMIN, ADMIN2);
    expect(await one(`select is_platform_admin from public.profiles where user_id = $1`, [ADMIN2])).toEqual({
      is_platform_admin: false,
    });
  });

  it("can't be done by editing the log or profile directly", async () => {
    await expect(
      as(db, ADMIN, () => db.query(`update public.user_removals set restored_at = now()`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("restoring someone removed with 'Let this email sign up again'", () => {
  it("puts back their email, sign-in methods and account details", async () => {
    await remove(GOOG, true);
    expect((await db.query(`select 1 from auth.identities where user_id = $1`, [GOOG])).rows).toHaveLength(0);

    const result = await restore(ADMIN, GOOG);
    expect(result).toEqual({ email: "goog@example.com", display_name: "Goog Le", needs_password_reset: false });
    const u = await one<{ email: string; raw_user_meta_data: Record<string, string>; banned_until: Date | null }>(
      `select email, raw_user_meta_data, banned_until from auth.users where id = $1`,
      [GOOG],
    );
    expect(u).toEqual({
      email: "goog@example.com",
      raw_user_meta_data: { name: "Goog Le", avatar_url: "x" },
      banned_until: null,
    });
    const ids = await db.query<{ provider: string; email: string }>(
      `select provider, email from auth.identities where user_id = $1 order by provider`,
      [GOOG],
    );
    expect(ids.rows).toEqual([
      { provider: "email", email: "goog@example.com" },
      { provider: "google", email: "goog@example.com" },
    ]);
    expect(await one(`select display_name from public.participants where user_id = $1`, [GOOG])).toEqual({
      display_name: "G",
    });
  });

  it("refuses when the email now belongs to a new account, and changes nothing", async () => {
    await remove(TAKEN, true);
    await db.query(`insert into auth.users (id, email) values ($1, 'Taken@example.com')`, [NEWBIE]);

    await expect(restore(ADMIN, TAKEN)).rejects.toThrow(/already signed up again/);
    const u = await one<{ email: string; banned_until: Date }>(`select email, banned_until from auth.users where id = $1`, [TAKEN]);
    expect(u.email).toBe(`removed-${TAKEN}@removed.invalid`);
    expect(u.banned_until.getUTCFullYear()).toBe(2999);
    expect(await one(`select display_name from public.profiles where user_id = $1`, [TAKEN])).toEqual({
      display_name: "Removed user",
    });
    expect(await one(`select restored_at from public.user_removals where user_id = $1`, [TAKEN])).toEqual({
      restored_at: null,
    });
  });

  it("for removals made before OTC-18, recreates an email sign-in and says a new password is needed", async () => {
    await remove(OLD, true);
    // What a removal from before this change looks like: nothing extra saved.
    await db.query(
      `update public.user_removals set previous_names = null, identities = null, user_meta = null, was_tester = null
        where user_id = $1`,
      [OLD],
    );

    const result = await restore(ADMIN, OLD);
    expect(result).toEqual({ email: "old@example.com", display_name: "Old Timer", needs_password_reset: true });
    const ids = await db.query<{ provider: string; provider_id: string; email: string }>(
      `select provider, provider_id, email from auth.identities where user_id = $1`,
      [OLD],
    );
    expect(ids.rows).toEqual([{ provider: "email", provider_id: OLD, email: "old@example.com" }]);
    // Their table nickname wasn't kept, so the profile name is used.
    expect(await one(`select display_name from public.participants where user_id = $1`, [OLD])).toEqual({
      display_name: "Old Timer",
    });
  });
});

describe("admin_list_users after a restore", () => {
  it("shows restored users as active, with their real email", async () => {
    const rows = await as(db, ADMIN, async () =>
      (await db.query<{ user_id: string; email: string; removed_at: string | null }>(`select * from public.admin_list_users()`)).rows,
    );
    const goog = rows.find((r) => r.user_id === GOOG)!;
    expect(goog).toMatchObject({ email: "goog@example.com", removed_at: null });
    const taken = rows.find((r) => r.user_id === TAKEN)!;
    expect(taken.email).toBe("taken@example.com");
    expect(taken.removed_at).not.toBeNull();
  });
});
