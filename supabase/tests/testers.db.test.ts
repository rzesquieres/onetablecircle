import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asVisitor, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000e001";
const OLD_USER = "00000000-0000-0000-0000-00000000e002";
const NEW_USER = "00000000-0000-0000-0000-00000000e003";
const GUEST = { id: "00000000-0000-0000-0000-00000000e004", anonymous: true };

let db: PGlite;

/** Call the hook the way Supabase Auth does (as supabase_auth_admin). */
async function hook(user: Record<string, unknown>) {
  await db.exec("set role supabase_auth_admin");
  try {
    const res = await db.query<{ r: Record<string, unknown> }>(`select public.hook_before_user_created($1) as r`, [
      JSON.stringify({ metadata: { name: "before-user-created" }, user }),
    ]);
    return res.rows[0].r;
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = await createTestDb();
  // Users are created after the migrations ran, so add "old" to the list the way
  // the migration's backfill does for accounts that already exist.
  await db.query(
    `insert into auth.users (id, email, is_anonymous) values ($1, 'Admin@Example.com', false), ($2, 'old@example.com', false), ($3, 'new@example.com', false), ($4, null, true)`,
    [ADMIN, OLD_USER, NEW_USER, GUEST.id],
  );
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
  await db.query(`insert into public.beta_testers (email, note) values ('old@example.com', 'Existing account')`);
  await db.query(`update public.app_config set invite_only = true`); // the migration's default
}, 60_000);

describe("sign-up hook", () => {
  it("rejects unlisted emails with a friendly message", async () => {
    const r = await hook({ email: "stranger@example.com", is_anonymous: false });
    expect(r).toMatchObject({ error: { http_code: 403 } });
    expect(String((r.error as { message: string }).message)).toMatch(/private testing/);
  });

  it("allows listed testers (any letter case) and quick guests", async () => {
    expect(await hook({ email: "OLD@example.com", is_anonymous: false })).toEqual({});
    expect(await hook({ email: null, is_anonymous: true })).toEqual({});
  });

  it("allows everyone when invite-only is switched off", async () => {
    await as(db, ADMIN, () => db.query(`update public.app_config set invite_only = false`));
    expect(await hook({ email: "stranger@example.com", is_anonymous: false })).toEqual({});
    await as(db, ADMIN, () => db.query(`update public.app_config set invite_only = true`));
  });

  it("can't be called by app users", async () => {
    await expect(
      as(db, NEW_USER, () => db.query(`select public.hook_before_user_created('{}'::jsonb)`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("testers list", () => {
  it("only admins can see and change it", async () => {
    expect((await as(db, NEW_USER, () => db.query(`select 1 from public.beta_testers`))).rows).toHaveLength(0);
    await expect(
      as(db, NEW_USER, () => db.query(`insert into public.beta_testers (email) values ('me@example.com')`)),
    ).rejects.toThrow(/row-level security/);
    await as(db, ADMIN, () => db.query(`insert into public.beta_testers (email, note) values ('friend@example.com', 'Ana')`));
    await expect(
      as(db, ADMIN, () => db.query(`insert into public.beta_testers (email) values ('Not An Email')`)),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("hosting", () => {
  const host = (who: string) =>
    as(db, who, () => db.query(`insert into public.sessions (host_id, title) values ($1, 'T')`, [who]));

  it("testers and admins can host; others can't while invite-only is on", async () => {
    await host(OLD_USER);
    await host(ADMIN);
    await expect(host(NEW_USER)).rejects.toThrow(/row-level security/);
    expect((await as(db, NEW_USER, () => db.query<{ ok: boolean }>(`select public.can_host() as ok`))).rows[0].ok).toBe(false);
  });

  it("adding someone to the list lets them host", async () => {
    await as(db, ADMIN, () => db.query(`insert into public.beta_testers (email) values ('new@example.com')`));
    await host(NEW_USER);
  });

  it("signed-out visitors can't call the hosting check", async () => {
    await expect(asVisitor(db, () => db.query(`select public.can_host()`))).rejects.toThrow(/permission denied/);
  });

  it("guests still can't host", async () => {
    await expect(
      as(db, GUEST, () => db.query(`insert into public.sessions (host_id, title) values ($1, 'T')`, [GUEST.id])),
    ).rejects.toThrow(/row-level security/);
  });
});
