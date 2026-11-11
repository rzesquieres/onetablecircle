import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-11: anyone at the table (including quick guests) can add someone without a phone.
const HOST = "00000000-0000-0000-0000-0000000011a1";
const GUEST = { id: "00000000-0000-0000-0000-0000000011b2", anonymous: true };
const OTHER_GUEST = { id: "00000000-0000-0000-0000-0000000011c3", anonymous: true };
const STRANGER = { id: "00000000-0000-0000-0000-0000000011d4", anonymous: true };

let db: PGlite;
let sessionId: string;
let guestPid: string;

async function newTable(title: string) {
  const s = await as(db, HOST, () =>
    db.query<{ id: string; join_code: string }>(
      `insert into public.sessions (host_id, title) values ($1, $2) returning id, join_code`,
      [HOST, title],
    ),
  );
  return s.rows[0];
}

const addPerson = (actor: typeof GUEST | string, session: string, name: string) =>
  as(db, actor, () => db.query<{ id: string }>("select public.add_offline_person($1, $2) as id", [session, name])).then(
    (r) => r.rows[0].id,
  );

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email) values ($1, 'host@example.com'), ($2, null), ($3, null), ($4, null)`,
    [HOST, GUEST.id, OTHER_GUEST.id, STRANGER.id],
  );
  const t = await newTable("Lunch");
  sessionId = t.id;
  for (const [g, name] of [
    [GUEST, "Ana"],
    [OTHER_GUEST, "Ben"],
  ] as const) {
    await as(db, g, () => db.query("select public.join_session($1, $2)", [t.join_code, name]));
  }
  const p = await db.query<{ id: string }>("select id from public.participants where user_id = $1", [GUEST.id]);
  guestPid = p.rows[0].id;
}, 60_000);

describe("adding someone without a phone", () => {
  let lolaPid: string;

  it("a guest can add a person, who is recorded as added by them", async () => {
    lolaPid = await addPerson(GUEST, sessionId, "  Lola  ");
    const r = await as(db, OTHER_GUEST, () =>
      db.query("select display_name, user_id, added_by from public.participants where id = $1", [lolaPid]),
    );
    expect(r.rows).toEqual([{ display_name: "Lola", user_id: null, added_by: guestPid }]);
  });

  it("the guest can order for that person and share an item with them", async () => {
    await as(db, GUEST, () =>
      db.query("select public.add_order_item($1, 'Sinigang', 32000, 1, '', false, $2)", [sessionId, [lolaPid]]),
    );
    await as(db, GUEST, () =>
      db.query("select public.add_order_item($1, 'Platter', 60000, 1, '', true, $2)", [sessionId, [guestPid, lolaPid]]),
    );
    const r = await as(db, HOST, () =>
      db.query<{ n: number }>("select count(*)::int as n from public.order_item_assignees where participant_id = $1", [lolaPid]),
    );
    expect(r.rows[0].n).toBe(2);
  });

  it("only the guest who added the items can edit them, not other guests", async () => {
    const other = await as(db, OTHER_GUEST, () =>
      db.query("update public.order_items set quantity = 2 where name = 'Sinigang' returning id"),
    );
    expect(other.rows).toHaveLength(0);
    const mine = await as(db, GUEST, () =>
      db.query("update public.order_items set quantity = 2 where name = 'Sinigang' returning id"),
    );
    expect(mine.rows).toHaveLength(1);
  });

  it("someone who is not at the table cannot add people", async () => {
    await expect(addPerson(STRANGER, sessionId, "Sneaky")).rejects.toThrow(/not part of this table/);
  });

  it("a blank name is rejected", async () => {
    await expect(addPerson(GUEST, sessionId, "   ")).rejects.toThrow(/Type their name/);
  });

  it("guests cannot insert people directly, only through the function", async () => {
    await expect(
      as(db, GUEST, () => db.query("insert into public.participants (session_id, display_name) values ($1, 'X')", [sessionId])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("removing someone you added", () => {
  it("the adder can remove them while nothing is ordered for them; other guests cannot", async () => {
    const pid = await addPerson(GUEST, sessionId, "Tito");
    const other = await as(db, OTHER_GUEST, () => db.query("delete from public.participants where id = $1 returning id", [pid]));
    expect(other.rows).toHaveLength(0);
    const mine = await as(db, GUEST, () => db.query("delete from public.participants where id = $1 returning id", [pid]));
    expect(mine.rows).toHaveLength(1);
  });

  it("the adder cannot remove someone who has items", async () => {
    const r = await as(db, GUEST, () =>
      db.query("delete from public.participants where display_name = 'Lola' and session_id = $1 returning id", [sessionId]),
    );
    expect(r.rows).toHaveLength(0);
  });

  it("guests cannot remove people who joined with their own phone", async () => {
    const r = await as(db, GUEST, () =>
      db.query("delete from public.participants where user_id = $1 returning id", [OTHER_GUEST.id]),
    );
    expect(r.rows).toHaveLength(0);
  });
});

describe("when ordering is closed", () => {
  it("guests cannot add people, but the host still can", async () => {
    const pid = await addPerson(GUEST, sessionId, "Before close");
    await as(db, HOST, () => db.query("update public.sessions set status = 'closed' where id = $1", [sessionId]));
    await expect(addPerson(GUEST, sessionId, "Too late")).rejects.toThrow(/Ordering is closed/);
    // ...and can no longer remove the person they added either.
    const del = await as(db, GUEST, () => db.query("delete from public.participants where id = $1 returning id", [pid]));
    expect(del.rows).toHaveLength(0);
    await expect(addPerson(HOST, sessionId, "Host adds")).resolves.toBeTruthy();
    await as(db, HOST, () => db.query("update public.sessions set status = 'open' where id = $1", [sessionId]));
  });
});

describe("table size limit", () => {
  it("stops at 30 people", async () => {
    const t = await newTable("Big group");
    for (let i = 1; i < 30; i++) await addPerson(HOST, t.id, `Person ${i}`); // host + 29 = 30
    await expect(addPerson(HOST, t.id, "One too many")).rejects.toThrow(/full \(30 people\)/);
  });
});
