import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asVisitor, createTestDb } from "./db";

const HOST = "00000000-0000-0000-0000-0000000000a1";
const GUEST = { id: "00000000-0000-0000-0000-0000000000b2", anonymous: true };
const OTHER_GUEST = { id: "00000000-0000-0000-0000-0000000000c3", anonymous: true };

let db: PGlite;
let sessionId: string;
let joinCode: string;

beforeAll(async () => {
  db = await createTestDb();
  // Anonymous users have no email, like Supabase's anonymous sign-in.
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'host@example.com', '{"full_name":"Ronnel"}'),
       ($2, null, '{}'),
       ($3, null, '{}')`,
    [HOST, GUEST.id, OTHER_GUEST.id],
  );
  const s = await as(db, HOST, () =>
    db.query<{ id: string; join_code: string }>(
      `insert into public.sessions (host_id, title) values ($1, 'Kape tayo') returning id, join_code`,
      [HOST],
    ),
  );
  sessionId = s.rows[0].id;
  joinCode = s.rows[0].join_code;
}, 60_000);

describe("table preview (join screen)", () => {
  it("anyone with the code sees title, host and head count, even signed out", async () => {
    const r = await asVisitor(db, () => db.query("select * from public.table_preview($1)", [joinCode.toLowerCase()]));
    expect(r.rows).toEqual([{ title: "Kape tayo", host_name: "Ronnel", status: "open", people: 1 }]);
  });

  it("a wrong code shows nothing", async () => {
    const r = await asVisitor(db, () => db.query("select * from public.table_preview('ZZZZZZZZ')"));
    expect(r.rows).toHaveLength(0);
  });

  it("signed-out visitors still cannot read tables directly", async () => {
    await expect(asVisitor(db, () => db.query("select * from public.sessions"))).rejects.toThrow(/permission denied/);
  });
});

describe("quick guests", () => {
  let guestPid: string;

  it("profiles for guests start as 'Guest'", async () => {
    const r = await db.query<{ display_name: string }>("select display_name from public.profiles where user_id = $1", [GUEST.id]);
    expect(r.rows[0].display_name).toBe("Guest");
  });

  it("a guest joins with just a name, which is saved for next time", async () => {
    const r = await as(db, GUEST, () =>
      db.query<{ id: string }>("select public.join_session($1, 'Tita Baby') as id", [joinCode]),
    );
    expect(r.rows[0].id).toBe(sessionId);
    const p = await as(db, GUEST, () =>
      db.query<{ id: string; display_name: string }>(
        "select id, display_name from public.participants where user_id = $1",
        [GUEST.id],
      ),
    );
    expect(p.rows[0].display_name).toBe("Tita Baby");
    guestPid = p.rows[0].id;
    const prof = await as(db, GUEST, () => db.query<{ display_name: string }>("select display_name from public.profiles"));
    expect(prof.rows).toEqual([{ display_name: "Tita Baby" }]);
  });

  it("a guest can order and tick items like everyone else", async () => {
    const item = await as(db, GUEST, () =>
      db.query<{ id: string }>(
        "select public.add_order_item($1, 'Ensaymada', 9500, 1, '', false, $2) as id",
        [sessionId, [guestPid]],
      ),
    );
    await as(db, GUEST, () =>
      db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [
        item.rows[0].id,
        guestPid,
      ]),
    );
  });

  it("a guest cannot host a table", async () => {
    await expect(
      as(db, GUEST, () => db.query(`insert into public.sessions (host_id, title) values ($1, 'x')`, [GUEST.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("a guest who has not joined cannot see the table", async () => {
    const r = await as(db, OTHER_GUEST, () => db.query("select * from public.order_items"));
    expect(r.rows).toHaveLength(0);
  });

  it("a real account joining does not get its profile renamed", async () => {
    const FRIEND = "00000000-0000-0000-0000-0000000000d4";
    await db.query(`insert into auth.users (id, email) values ($1, 'friend@example.com')`, [FRIEND]);
    await as(db, FRIEND, () => db.query("select public.join_session($1, 'Nickname')", [joinCode]));
    const prof = await db.query<{ display_name: string }>("select display_name from public.profiles where user_id = $1", [FRIEND]);
    expect(prof.rows[0].display_name).toBe("friend");
  });
});
