import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

// OTC-35: the host chooses how service charge and tip are shared.
const HOST = "00000000-0000-0000-0000-0000000035a1";
const ANA = "00000000-0000-0000-0000-0000000035b2";

let db: PGlite;
let receiptId: string;

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, email) values ($1, 'h@x'), ($2, 'a@x')", [HOST, ANA]);
  const s = await as(db, HOST, async () =>
    (await db.query<{ id: string; join_code: string }>("insert into public.sessions (host_id, title) values ($1, 'Dinner') returning id, join_code", [HOST])).rows[0],
  );
  await as(db, ANA, () => db.query("select public.join_session($1, 'Ana')", [s.join_code]));
  receiptId = await as(db, HOST, async () =>
    (await db.query<{ id: string }>("insert into public.receipts (session_id) values ($1) returning id", [s.id])).rows[0].id,
  );
}, 60_000);

const splits = async () =>
  (await db.query<{ service_split: string; tip_split: string }>("select service_split, tip_split from public.receipts where id = $1", [receiptId])).rows[0];

describe("charge split settings", () => {
  it("default to 'by what they ordered'", async () => {
    expect(await splits()).toEqual({ service_split: "ordered", tip_split: "ordered" });
  });

  it("the host can change them, only to known values", async () => {
    await as(db, HOST, () => db.query("update public.receipts set tip_split = 'even' where id = $1", [receiptId]));
    expect((await splits()).tip_split).toBe("even");
    await expect(as(db, HOST, () => db.query("update public.receipts set service_split = 'random' where id = $1", [receiptId]))).rejects.toThrow(
      /check constraint/,
    );
  });

  it("others at the table can't", async () => {
    const r = await as(db, ANA, () => db.query("update public.receipts set tip_split = 'ordered' where id = $1 returning id", [receiptId]));
    expect(r.rows).toHaveLength(0);
    expect((await splits()).tip_split).toBe("even");
  });
});
