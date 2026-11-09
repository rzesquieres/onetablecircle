import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asVisitor, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000f001";
const USER = "00000000-0000-0000-0000-00000000f002";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com'), ($2, 'user@example.com')`, [ADMIN, USER]);
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
}, 60_000);

const join = (email: string, plan = "undecided") =>
  db.query(`select public.join_waitlist($1, $2)`, [email, plan]);

describe("waitlist", () => {
  it("lets signed-out visitors join, normalising the email", async () => {
    await asVisitor(db, () => join("  Ana@Example.COM ", "yearly"));
    const rows = await db.query<{ email: string; plan: string }>(`select email, plan from public.waitlist`);
    expect(rows.rows).toEqual([{ email: "ana@example.com", plan: "yearly" }]);
  });

  it("accepts a repeat signup quietly and keeps the latest plan", async () => {
    await as(db, USER, () => join("ana@example.com", "monthly"));
    const rows = await db.query<{ plan: string }>(`select plan from public.waitlist where email = 'ana@example.com'`);
    expect(rows.rows).toEqual([{ plan: "monthly" }]);
  });

  it("rejects bad emails and plans", async () => {
    await expect(asVisitor(db, () => join("not-an-email"))).rejects.toThrow(/valid email/);
    await expect(asVisitor(db, () => join("b@example.com", "lifetime"))).rejects.toThrow(/Unknown plan/);
  });

  it("only admins can read the list", async () => {
    await expect(asVisitor(db, () => db.query(`select * from public.waitlist`))).rejects.toThrow(/permission denied/);
    const asUser = await as(db, USER, () => db.query(`select * from public.waitlist`));
    expect(asUser.rows).toHaveLength(0);
    const asAdmin = await as(db, ADMIN, () => db.query(`select * from public.waitlist`));
    expect(asAdmin.rows).toHaveLength(1);
  });

  it("can't be written directly, only through join_waitlist()", async () => {
    await expect(
      as(db, USER, () => db.query(`insert into public.waitlist (email) values ('c@example.com')`)),
    ).rejects.toThrow(/permission denied/);
  });
});
