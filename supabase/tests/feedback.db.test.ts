import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asVisitor, createTestDb } from "./db";

const ADMIN = "00000000-0000-0000-0000-00000000d001";
const ANA = "00000000-0000-0000-0000-00000000d002";
const GUEST = "00000000-0000-0000-0000-00000000d003";
const BEN = "00000000-0000-0000-0000-00000000d004";
const guest = { id: GUEST, anonymous: true };

let db: PGlite;
let tableId: string;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email, is_anonymous) values
       ($1, 'admin@example.com', false), ($2, 'Ana@Example.com', false), ($3, null, true), ($4, 'ben@example.com', false)`,
    [ADMIN, ANA, GUEST, BEN],
  );
  await db.query(`update public.profiles set is_platform_admin = true where user_id = $1`, [ADMIN]);
  await db.query(`update public.profiles set display_name = 'Ana' where user_id = $1`, [ANA]);
  await db.query(`update public.app_config set daily_feedback_limit = 2`);
  const s = await db.query<{ id: string }>(`insert into public.sessions (host_id, title) values ($1, 'Friday dinner') returning id`, [ANA]);
  tableId = s.rows[0].id;
  await db.query(
    `insert into public.participants (session_id, user_id, display_name) values ($1, $2, 'Carlo') on conflict do nothing`,
    [tableId, GUEST],
  );
}, 60_000);

interface Args {
  category?: string;
  message?: string;
  page?: string;
  table?: string | null;
  email?: string | null;
  contactOk?: boolean;
}
const send = (a: Args = {}) =>
  db
    .query<{ id: string }>(`select public.submit_feedback($1, $2, $3, $4, $5, $6, $7) as id`, [
      a.category ?? "idea",
      a.message ?? "Love it",
      a.page ?? "/",
      a.table ?? null,
      a.email ?? null,
      a.contactOk ?? false,
      "test-agent",
    ])
    .then((r) => r.rows[0].id);

const row = (id: string) =>
  db.query<Record<string, unknown>>(`select * from public.feedback where id = $1`, [id]).then((r) => r.rows[0]);

describe("feedback", () => {
  it("records an account holder's feedback with their name and account email when they're OK to be contacted", async () => {
    const id = await as(db, ANA, () => send({ category: "bug", message: "  Split looks off  ", page: "/profile", contactOk: true }));
    expect(await row(id)).toMatchObject({
      user_id: ANA,
      sender_name: "Ana",
      sender_is_guest: false,
      contact_email: "ana@example.com",
      kind: "form",
      category: "bug",
      message: "Split looks off",
      page_path: "/profile",
      session_id: null,
      user_agent: "test-agent",
      status: "new",
    });
  });

  it("lets a link guest send feedback tied to their table, with the name they use there", async () => {
    const id = await as(db, guest, () => send({ table: tableId, email: "Carlo@Mail.com", contactOk: true }));
    expect(await row(id)).toMatchObject({
      user_id: GUEST,
      sender_name: "Carlo",
      sender_is_guest: true,
      contact_email: "carlo@mail.com",
      session_id: tableId,
      table_title: "Friday dinner",
    });
  });

  it("drops the table if the sender isn't at it", async () => {
    const id = await as(db, BEN, () => send({ table: tableId }));
    expect(await row(id)).toMatchObject({ session_id: null, table_title: "", contact_email: null });
  });

  it("checks the input", async () => {
    await expect(as(db, BEN, () => send({ category: "rant" }))).rejects.toThrow(/what kind/);
    await expect(as(db, BEN, () => send({ message: "   " }))).rejects.toThrow(/type your feedback/);
    await expect(as(db, BEN, () => send({ message: "x".repeat(2001) }))).rejects.toThrow(/2,000/);
    await expect(as(db, guest, () => send({ contactOk: true, email: "nope" }))).rejects.toThrow(/valid email/);
  });

  it("needs a login (visitors are signed in as guests first)", async () => {
    await expect(asVisitor(db, () => send())).rejects.toThrow(/permission denied/);
  });

  it("limits each person per Manila day, but not admins", async () => {
    await as(db, BEN, () => send()); // Ben's 2nd today (limit 2)
    await expect(as(db, BEN, () => send())).rejects.toMatchObject({ code: "OT429" });
    await db.query(`update public.feedback set created_at = public.manila_day_start() - interval '1 minute' where user_id = $1`, [BEN]);
    await expect(as(db, BEN, () => send())).resolves.toBeTruthy();
    for (let i = 0; i < 4; i++) await as(db, ADMIN, () => send());
  });

  it("only admins can read feedback or change its status", async () => {
    const mine = await as(db, ANA, () => db.query(`select * from public.feedback`));
    expect(mine.rows).toHaveLength(0);
    await expect(asVisitor(db, () => db.query(`select * from public.feedback`))).rejects.toThrow(/permission denied/);
    const upd = await as(db, ANA, () => db.query(`update public.feedback set status = 'done'`));
    expect(upd.affectedRows).toBe(0);
    const all = await as(db, ADMIN, () => db.query(`select * from public.feedback`));
    expect(all.rows.length).toBeGreaterThan(5);
    await as(db, ADMIN, () => db.query(`update public.feedback set status = 'read' where user_id = $1`, [ANA]));
    const r = await db.query<{ status: string }>(`select status from public.feedback where user_id = $1`, [ANA]);
    expect(r.rows[0].status).toBe("read");
  });

  it("can't be written directly, only through submit_feedback()", async () => {
    await expect(
      as(db, ANA, () => db.query(`insert into public.feedback (category, message) values ('idea', 'hi')`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, ADMIN, () => db.query(`update public.feedback set message = 'edited'`)),
    ).rejects.toThrow(/permission denied/);
  });
});
