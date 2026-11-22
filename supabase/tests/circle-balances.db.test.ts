import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-34: running balances across meals in a saved Circle.
const ANA = "00000000-0000-0000-0000-0000000034a1"; // owns the Circle
const BEN = "00000000-0000-0000-0000-0000000034b2"; // member with an account
const GUEST = { id: "00000000-0000-0000-0000-0000000034c3", anonymous: true }; // "Lola", name-only member
const STRANGER = "00000000-0000-0000-0000-0000000034d4";

let db: PGlite;
let groupId: string;
const key: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
type Ledger = {
  me: string | null;
  is_owner: boolean;
  members: { id: string; name: string }[];
  tables: { session_id: string; host_key: string; shares: { key: string | null; total: number; paid: boolean }[] }[];
  settlements: { id: string; from: string; to: string; amount: number }[];
};
const ledger = (actor: string | typeof GUEST) =>
  as(db, actor, async () => (await one<{ l: Ledger }>("select public.circle_ledger($1) as l", [groupId])).l);

/** A finished table hosted by `host`, with Ben and "Lola" (a guest) each owing `each`. */
async function meal(host: string, title: string, each: number, link: boolean) {
  const s = await as(db, host, () =>
    one<{ id: string; join_code: string }>("insert into public.sessions (host_id, title) values ($1, $2) returning id, join_code", [host, title]),
  );
  for (const [actor, name] of [[ANA, "Ana"], [BEN, "Ben"], [GUEST, "lola "]] as const) {
    if (actor !== host) await as(db, actor, () => db.query("select public.join_session($1, $2)", [s.join_code, name]));
  }
  if (link) await as(db, ANA, () => db.query("select public.set_table_circle($1, $2)", [s.id, groupId]));
  const ps = (await db.query<{ id: string; user_id: string }>("select id, user_id from public.participants where session_id = $1", [s.id])).rows;
  await as(db, host, async () => {
    const r = await one<{ id: string }>("insert into public.receipts (session_id) values ($1) returning id", [s.id]);
    await db.query(
      "insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos, split) values ($1, $2, 'FOOD', $3, 'everyone')",
      [r.id, s.id, each * ps.length],
    );
    const shares = ps.map((p) => ({
      participant_id: p.id, items_centavos: each, service_centavos: 0, tax_centavos: 0, discount_centavos: 0,
      tip_centavos: 0, total_centavos: each, breakdown: [],
    }));
    await db.query("select public.finalize_bill($1, $2)", [s.id, JSON.stringify(shares)]);
  });
  return { id: s.id, pid: Object.fromEntries(ps.map((p) => [p.user_id, p.id])) as Record<string, string> };
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, email, is_anonymous) values ($1, 'a@x', false), ($2, 'b@x', false), ($3, null, true), ($4, 's@x', false)", [
    ANA, BEN, GUEST.id, STRANGER,
  ]);
  await db.query("update public.profiles set display_name = 'Ana' where user_id = $1", [ANA]);
  // Ana and Ben must have shared a table before Ben can be saved with his account.
  const first = await as(db, ANA, () => one<{ join_code: string }>("insert into public.sessions (host_id, title) values ($1, 'First') returning join_code", [ANA]));
  await as(db, BEN, () => db.query("select public.join_session($1, 'Ben')", [first.join_code]));
  groupId = await as(db, ANA, async () => {
    const g = await one<{ id: string }>("insert into public.saved_groups (name) values ('Barkada') returning id");
    await db.query("insert into public.saved_group_members (group_id, user_id, display_name, sort_order) values ($1, $2, 'Ben', 0)", [g.id, BEN]);
    await db.query("insert into public.saved_group_members (group_id, display_name, sort_order) values ($1, 'Lola', 1)", [g.id]);
    return g.id;
  });
  const ms = (await db.query<{ id: string; display_name: string }>("select id, display_name from public.saved_group_members where group_id = $1", [groupId])).rows;
  key.ben = ms.find((m) => m.display_name === "Ben")!.id;
  key.lola = ms.find((m) => m.display_name === "Lola")!.id;
}, 60_000);

describe("linking tables", () => {
  it("only the group's owner can link a table they were at", async () => {
    const s = await as(db, BEN, () => one<{ id: string }>("insert into public.sessions (host_id, title) values ($1, 'Bens') returning id", [BEN]));
    await expect(as(db, BEN, () => db.query("select public.set_table_circle($1, $2)", [s.id, groupId]))).rejects.toThrow(/Group not found/);
    await expect(as(db, ANA, () => db.query("select public.set_table_circle($1, $2)", [s.id, groupId]))).rejects.toThrow(/not part of this table/);
    await expect(as(db, ANA, () => db.query("update public.sessions set saved_group_id = $2 where id = $1", [s.id, groupId]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("the ledger", () => {
  it("matches the owner, members with accounts, and name-only guests; unlinked tables don't count", async () => {
    await meal(ANA, "Lunch", 30000, true);
    await meal(BEN, "Dinner", 10000, true);
    await meal(ANA, "Not in the Circle", 99900, false);
    const l = await ledger(ANA);
    expect(l.is_owner).toBe(true);
    expect(l.me).toBe("owner");
    expect(l.members.map((m) => m.name)).toEqual(["Ana", "Ben", "Lola"]);
    expect(l.tables).toHaveLength(2);
    const lunch = l.tables.find((t) => t.host_key === "owner")!;
    expect(lunch.shares.map((s) => s.key).sort()).toEqual(["owner", key.ben, key.lola].sort());
    const dinner = l.tables.find((t) => t.host_key === key.ben)!;
    expect(dinner.shares.find((s) => s.key === key.lola)).toMatchObject({ total: 10000, paid: false });
  });

  it("members with accounts can see it; guests and strangers can't", async () => {
    expect((await ledger(BEN)).me).toBe(key.ben);
    await expect(ledger(GUEST)).rejects.toThrow(/Circle not found/);
    await expect(ledger(STRANGER)).rejects.toThrow(/Circle not found/);
    const mine = await as(db, BEN, async () =>
      (await db.query<{ name: string; is_owner: boolean; tables: number }>("select name, is_owner, tables::int as tables from public.my_circles()")).rows,
    );
    expect(mine).toEqual([{ name: "Barkada", is_owner: false, tables: 2 }]);
  });

  it("confirmed payments show as paid", async () => {
    const m = await meal(ANA, "Merienda", 5000, true);
    await as(db, ANA, () => db.query("select public.confirm_payment($1, $2, true)", [m.id, m.pid[BEN]]));
    const t = (await ledger(ANA)).tables.find((x) => x.session_id === m.id)!;
    expect(t.shares.find((s) => s.key === key.ben)!.paid).toBe(true);
  });
});

describe("settle-ups", () => {
  it("the owner records any; a member only their own; whoever recorded can undo", async () => {
    const id = await as(db, ANA, async () =>
      (await one<{ id: string }>("select public.record_circle_settlement($1, $2, 'owner', 20000, 'GCash') as id", [groupId, key.lola])).id,
    );
    await as(db, BEN, () => db.query("select public.record_circle_settlement($1, $2, 'owner', 1000, '')", [groupId, key.ben]));
    await expect(as(db, BEN, () => db.query("select public.record_circle_settlement($1, $2, 'owner', 1000, '')", [groupId, key.lola]))).rejects.toThrow(
      /only record payments you made or received/,
    );
    await expect(as(db, BEN, () => db.query("select public.record_circle_settlement($1, $2, $2, 1000, '')", [groupId, key.ben]))).rejects.toThrow(
      /two different people/,
    );
    await expect(as(db, ANA, () => db.query("select public.record_circle_settlement($1, 'nobody', 'owner', 1000, '')", [groupId]))).rejects.toThrow(
      /two different people/,
    );
    await expect(as(db, ANA, () => db.query("select public.record_circle_settlement($1, $2, 'owner', 0, '')", [groupId, key.ben]))).rejects.toThrow(
      /Enter an amount/,
    );
    expect((await ledger(ANA)).settlements).toHaveLength(2);
    await expect(as(db, BEN, () => db.query("select public.delete_circle_settlement($1)", [id]))).rejects.toThrow(/Only the Circle's owner/);
    await as(db, ANA, () => db.query("select public.delete_circle_settlement($1)", [id]));
    expect((await ledger(ANA)).settlements).toHaveLength(1);
    await expect(as(db, BEN, () => db.query("select * from public.circle_settlements"))).rejects.toThrow(/permission denied/);
  });
});
