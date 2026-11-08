/**
 * Runs the real migration against an in-memory Postgres (PGlite) with a
 * minimal stand-in for Supabase's `auth` schema, then checks the security
 * rules from different users' points of view.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as as asUser, createTestDb } from "./db";

const HOST = "00000000-0000-0000-0000-00000000000a";
const FRIEND = "00000000-0000-0000-0000-00000000000b";
const STRANGER = "00000000-0000-0000-0000-00000000000c";

let db: PGlite;

const as = <T>(userId: string, fn: () => Promise<T>): Promise<T> => asUser(db, userId, fn);

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

let sessionId: string;
let joinCode: string;
let hostPid: string;
let friendPid: string;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'host@example.com', '{"full_name":"Ronnel"}'),
       ($2, 'friend@example.com', '{}'),
       ($3, 'stranger@example.com', '{}')`,
    [HOST, FRIEND, STRANGER],
  );
}, 60_000);

describe("profiles", () => {
  it("are created on sign-up with a sensible name", async () => {
    const all = await rows<{ display_name: string }>(
      "select display_name from public.profiles order by user_id",
    );
    expect(all.map((r) => r.display_name)).toEqual(["Ronnel", "friend", "stranger"]);
  });

  it("users cannot make themselves admin", async () => {
    await expect(
      as(FRIEND, () => db.query("update public.profiles set is_platform_admin = true")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("sessions", () => {
  it("host creates a table and becomes its first participant", async () => {
    const s = await as(HOST, () =>
      one<{ id: string; join_code: string }>(
        `insert into public.sessions (host_id, title) values ($1, 'Friday coffee') returning id, join_code`,
        [HOST],
      ),
    );
    sessionId = s.id;
    joinCode = s.join_code;
    expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const p = await as(HOST, () =>
      rows<{ id: string; display_name: string; is_host: boolean }>(
        "select id, display_name, is_host from public.participants where session_id = $1",
        [sessionId],
      ),
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ display_name: "Ronnel", is_host: true });
    hostPid = p[0].id;
  });

  it("cannot create a table on someone else's behalf", async () => {
    await expect(
      as(FRIEND, () =>
        db.query(`insert into public.sessions (host_id, title) values ($1, 'x')`, [HOST]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("strangers cannot see the table", async () => {
    const r = await as(STRANGER, () => rows("select * from public.sessions"));
    expect(r).toHaveLength(0);
  });

  it("friend joins with the code (twice is harmless) and then sees it", async () => {
    const id1 = await as(FRIEND, () =>
      one<{ id: string }>("select public.join_session($1, 'Ana') as id", [joinCode.toLowerCase()]),
    );
    const id2 = await as(FRIEND, () =>
      one<{ id: string }>("select public.join_session($1) as id", [joinCode]),
    );
    expect(id1.id).toBe(sessionId);
    expect(id2.id).toBe(sessionId);
    const p = await as(FRIEND, () =>
      rows<{ id: string; display_name: string; user_id: string }>(
        "select id, display_name, user_id from public.participants where session_id = $1 order by joined_at",
        [sessionId],
      ),
    );
    expect(p.map((x) => x.display_name)).toEqual(["Ronnel", "Ana"]);
    friendPid = p[1].id;
  });

  it("wrong code gives a clear error", async () => {
    await expect(
      as(STRANGER, () => db.query("select public.join_session('ZZZZZZZZ')")),
    ).rejects.toThrow(/Table not found/);
  });

  it("only the host can change the table; nobody can change host or code", async () => {
    await expect(
      as(FRIEND, () =>
        one<{ id: string }>(
          "update public.sessions set title = 'hijack' where id = $1 returning id",
          [sessionId],
        ),
      ),
    ).resolves.toBeUndefined(); // RLS silently matches 0 rows
    await expect(
      as(HOST, () => db.query("update public.sessions set join_code = 'AAAAAAAA' where id = $1", [sessionId])),
    ).rejects.toThrow(/permission denied/);
  });

  it("host can add a person by name; others cannot", async () => {
    await as(HOST, () =>
      db.query("insert into public.participants (session_id, display_name) values ($1, 'Lola')", [sessionId]),
    );
    await expect(
      as(FRIEND, () =>
        db.query("insert into public.participants (session_id, display_name) values ($1, 'Fake')", [sessionId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("ordering", () => {
  let latteId: string;
  let platterId: string;

  it("friend orders for themselves", async () => {
    const r = await as(FRIEND, () =>
      one<{ id: string }>(
        "select public.add_order_item($1, 'Iced latte', 18000, 3, 'oat milk', false, $2) as id",
        [sessionId, [friendPid]],
      ),
    );
    latteId = r.id;
    const a = await as(FRIEND, () =>
      rows("select participant_id, session_id from public.order_item_assignees where order_item_id = $1", [latteId]),
    );
    expect(a).toEqual([{ participant_id: friendPid, session_id: sessionId }]);
  });

  it("a shared item can be for several people", async () => {
    const r = await as(HOST, () =>
      one<{ id: string }>(
        "select public.add_order_item($1, 'Nachos platter', 45000, 1, '', true, $2) as id",
        [sessionId, [hostPid, friendPid, hostPid]],
      ),
    );
    platterId = r.id;
    const a = await as(HOST, () =>
      rows("select 1 from public.order_item_assignees where order_item_id = $1", [platterId]),
    );
    expect(a).toHaveLength(2); // duplicate removed
  });

  it("a non-shared item must be for exactly one person", async () => {
    await expect(
      as(FRIEND, () =>
        db.query("select public.add_order_item($1, 'x', null, 1, '', false, $2)", [sessionId, [hostPid, friendPid]]),
      ),
    ).rejects.toThrow(/exactly one person/);
  });

  it("strangers cannot order or read items", async () => {
    await expect(
      as(STRANGER, () =>
        db.query("select public.add_order_item($1, 'x', null, 1, '', false, $2)", [sessionId, [hostPid]]),
      ),
    ).rejects.toThrow(/not part of this table/);
    const r = await as(STRANGER, () => rows("select * from public.order_items"));
    expect(r).toHaveLength(0);
  });

  it("friend cannot delete the host's item, host can delete any item", async () => {
    const del = await as(FRIEND, () =>
      rows("delete from public.order_items where id = $1 returning id", [platterId]),
    );
    expect(del).toHaveLength(0);
    const tmp = await as(FRIEND, () =>
      one<{ id: string }>("select public.add_order_item($1, 'Water', 0, 1, '', false, $2) as id", [sessionId, [friendPid]]),
    );
    const del2 = await as(HOST, () =>
      rows("delete from public.order_items where id = $1 returning id", [tmp.id]),
    );
    expect(del2).toHaveLength(1);
  });

  describe("delivery checklist", () => {
    const served = async (itemId: string) =>
      Number(
        (await one<{ s: number }>(
          "select coalesce(sum(delta),0) as s from public.delivery_events where order_item_id = $1",
          [itemId],
        )).s,
      );

    it("anyone at the table can tick, and partial delivery is tracked", async () => {
      await as(HOST, () =>
        db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [latteId, hostPid]),
      );
      await as(FRIEND, () =>
        db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [latteId, friendPid]),
      );
      expect(await served(latteId)).toBe(2);
    });

    it("cannot serve more than ordered, or untick below zero", async () => {
      await as(HOST, () =>
        db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [latteId, hostPid]),
      );
      await expect(
        as(HOST, () =>
          db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [latteId, hostPid]),
        ),
      ).rejects.toThrow(/between 0 and 3/);
      await expect(
        as(HOST, () =>
          db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, -1, $2)", [platterId, hostPid]),
        ),
      ).rejects.toThrow(/between 0 and 1/);
    });

    it("unticking is recorded, and ticks cannot be forged or edited", async () => {
      await as(FRIEND, () =>
        db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, -1, $2)", [latteId, friendPid]),
      );
      expect(await served(latteId)).toBe(2);
      await expect(
        as(FRIEND, () =>
          db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [latteId, hostPid]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        as(HOST, () => db.query("delete from public.delivery_events")),
      ).rejects.toThrow(/permission denied/);
    });

    it("quantity cannot be reduced below what was served", async () => {
      await expect(
        as(FRIEND, () => db.query("update public.order_items set quantity = 1 where id = $1", [latteId])),
      ).rejects.toThrow(/already served/);
    });
  });

  it("after the cutoff, guests cannot add items but can still tick", async () => {
    await as(HOST, () =>
      db.query("update public.sessions set order_cutoff_at = now() - interval '1 minute' where id = $1", [sessionId]),
    );
    await expect(
      as(FRIEND, () =>
        db.query("select public.add_order_item($1, 'Late cake', 15000, 1, '', false, $2)", [sessionId, [friendPid]]),
      ),
    ).rejects.toThrow(/row-level security/);
    await as(FRIEND, () =>
      db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [latteId, friendPid]),
    );
  });

  it("once billing starts, ticking stops", async () => {
    await as(HOST, () => db.query("update public.sessions set status = 'billing' where id = $1", [sessionId]));
    await expect(
      as(FRIEND, () =>
        db.query("insert into public.delivery_events (order_item_id, delta, by_participant_id) values ($1, 1, $2)", [platterId, friendPid]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
