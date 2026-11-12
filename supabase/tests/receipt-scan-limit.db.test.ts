import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asVisitor, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000e001";
const ANA = "00000000-0000-0000-0000-00000000e002";
const BEN = "00000000-0000-0000-0000-00000000e003";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email) values ($1, 'admin@example.com'), ($2, 'ana@example.com'), ($3, 'ben@example.com')`,
    [ADMIN, ANA, BEN],
  );
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
  await db.query(`update public.app_config set daily_receipt_scan_limit = 3`);
}, 60_000);

const claim = (user: string) =>
  as(db, user, () => db.query<{ left: number | null }>(`select public.claim_receipt_scan(null) as left`)).then(
    (r) => r.rows[0].left,
  );

describe("daily receipt-scan limit", () => {
  it("counts down, then refuses with OT429 and a friendly message", async () => {
    expect(await claim(ANA)).toBe(2);
    expect(await claim(ANA)).toBe(1);
    expect(await claim(ANA)).toBe(0);
    await expect(claim(ANA)).rejects.toMatchObject({
      code: "OT429",
      message: expect.stringMatching(/limit of 3 receipt scans/),
    });
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.receipt_scans where user_id = $1`, [ANA]);
    expect(n.rows[0].n).toBe(3); // the refused one isn't recorded
  });

  it("is per person", async () => {
    expect(await claim(BEN)).toBe(2);
  });

  it("resets on the next Manila day", async () => {
    await db.query(`update public.receipt_scans set created_at = public.manila_day_start() - interval '1 minute' where user_id = $1`, [ANA]);
    expect(await claim(ANA)).toBe(2);
  });

  it("doesn't limit admins", async () => {
    for (let i = 0; i < 5; i++) expect(await claim(ADMIN)).toBeNull();
  });

  it("needs a signed-in person", async () => {
    await expect(asVisitor(db, () => db.query(`select public.claim_receipt_scan(null)`))).rejects.toThrow(
      /permission denied|sign in/,
    );
  });

  it("can't be written or edited directly, and people only see their own scans", async () => {
    await expect(
      as(db, ANA, () => db.query(`insert into public.receipt_scans (user_id) values ($1)`, [ANA])),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, ANA, () => db.query(`delete from public.receipt_scans`))).rejects.toThrow(/permission denied/);
    const mine = await as(db, BEN, () => db.query<{ user_id: string }>(`select user_id from public.receipt_scans`));
    expect(mine.rows.every((r) => r.user_id === BEN)).toBe(true);
  });

  it("only admins can change the limit", async () => {
    await as(db, ANA, () => db.query(`update public.app_config set daily_receipt_scan_limit = 999`));
    const r = await db.query<{ l: number }>(`select daily_receipt_scan_limit l from public.app_config`);
    expect(r.rows[0].l).toBe(3); // RLS silently filtered the row out
  });
});
