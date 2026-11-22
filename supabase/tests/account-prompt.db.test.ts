import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-36: invite guests to create an account after the bill is sent.
const HOST = "00000000-0000-0000-0000-0000000036a1";
const ANA = "00000000-0000-0000-0000-0000000036b2"; // has an account
const BEN = { id: "00000000-0000-0000-0000-0000000036c3", anonymous: true };
const CAT = { id: "00000000-0000-0000-0000-0000000036d4", anonymous: true };
const OUTSIDER = { id: "00000000-0000-0000-0000-0000000036e5", anonymous: true };

let db: PGlite;
let sessionId: string;

const due = (actor: string | typeof BEN) =>
  as(db, actor, async () => (await db.query<{ d: boolean }>("select public.account_prompt_due($1) as d", [sessionId])).rows[0].d);
const events = async (userId: string) =>
  (await db.query<{ event: string }>("select event from public.account_prompt_events where user_id = $1 order by id", [userId])).rows.map(
    (r) => r.event,
  );
const setStatus = (status: string) => db.query("update public.sessions set status = $2 where id = $1", [sessionId, status]);

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    "insert into auth.users (id, email, is_anonymous) values ($1, 'h@x', false), ($2, 'a@x', false), ($3, null, true), ($4, null, true), ($5, null, true)",
    [HOST, ANA, BEN.id, CAT.id, OUTSIDER.id],
  );
  const s = await as(db, HOST, async () =>
    (await db.query<{ id: string; join_code: string }>("insert into public.sessions (host_id, title) values ($1, 'Lunch') returning id, join_code", [HOST]))
      .rows[0],
  );
  sessionId = s.id;
  for (const [actor, name] of [[ANA, "Ana"], [BEN, "Ben"], [CAT, "Cat"]] as const) {
    await as(db, actor, () => db.query("select public.join_session($1, $2)", [s.join_code, name]));
  }
}, 60_000);

describe("when the prompt shows", () => {
  it("not before the bill is sent", async () => {
    expect(await due(BEN)).toBe(false);
    expect(await events(BEN.id)).toEqual([]);
  });

  it("to guests at the table once the bill is sent, and it's counted once", async () => {
    await setStatus("billing");
    expect(await due(BEN)).toBe(true);
    expect(await due(BEN)).toBe(true);
    expect(await events(BEN.id)).toEqual(["shown"]);
  });

  it("not to people with an account, or guests from elsewhere", async () => {
    expect(await due(ANA)).toBe(false);
    expect(await due(HOST)).toBe(false);
    expect(await due(OUTSIDER)).toBe(false);
  });

  it("not again after 'Not now' for this table", async () => {
    await as(db, CAT, () => db.query("select public.dismiss_account_prompt($1)", [sessionId]));
    expect(await due(CAT)).toBe(false);
    await expect(as(db, OUTSIDER, () => db.query("select public.dismiss_account_prompt($1)", [sessionId]))).rejects.toThrow(
      /not part of this table/,
    );
  });

  it("nobody can read or write the events directly", async () => {
    await expect(as(db, BEN, () => db.query("select * from public.account_prompt_events"))).rejects.toThrow(/permission denied/);
  });
});

describe("conversion", () => {
  it("a guest who saw the prompt and then saved an account is counted", async () => {
    await db.query("update auth.users set is_anonymous = false, email = 'ben@x' where id = $1", [BEN.id]);
    expect(await events(BEN.id)).toEqual(["shown", "converted"]);
    // Still the same participant, so the table is still theirs.
    expect((await db.query("select 1 from public.participants where user_id = $1", [BEN.id])).rows).toHaveLength(1);
    expect(await due(BEN.id)).toBe(false);
  });

  it("a guest who never saw it isn't counted", async () => {
    await db.query("update auth.users set is_anonymous = false where id = $1", [OUTSIDER.id]);
    expect(await events(OUTSIDER.id)).toEqual([]);
  });

  it("admins see the counts; others can't", async () => {
    await db.query("update public.profiles set is_platform_admin = true where user_id = $1", [HOST]);
    const stats = await as(db, HOST, async () => (await db.query<{ s: Record<string, number> }>("select public.admin_account_prompt_stats() as s")).rows[0].s);
    expect(stats).toMatchObject({ shown_users: 1, converted_users: 1, shown_30d: 1, converted_30d: 1 });
    await expect(as(db, ANA, () => db.query("select public.admin_account_prompt_stats()"))).rejects.toThrow(/Admins only/);
  });
});
