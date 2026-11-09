import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb } from "./db";

const HOST = "00000000-0000-0000-0000-00000000c001";
const ANA = "00000000-0000-0000-0000-00000000c002";
const BEN = "00000000-0000-0000-0000-00000000c003";
const STRANGER = "00000000-0000-0000-0000-00000000c004";

let db: PGlite;
let sessionId: string;
let receiptId: string;
const pid: Record<string, string> = {};
const item: Record<string, string> = {};
const line: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

/** A correct split for the receipt below: latte 200 (Ana), nachos 300 (shared 3), service 50. */
function goodShares() {
  return [
    { participant_id: pid.host, items_centavos: 10000, service_centavos: 1000, tax_centavos: 0, discount_centavos: 0, tip_centavos: 0, total_centavos: 11000, breakdown: [] },
    { participant_id: pid.ana, items_centavos: 30000, service_centavos: 3000, tax_centavos: 0, discount_centavos: 0, tip_centavos: 0, total_centavos: 33000, breakdown: [] },
    { participant_id: pid.ben, items_centavos: 10000, service_centavos: 1000, tax_centavos: 0, discount_centavos: 0, tip_centavos: 0, total_centavos: 11000, breakdown: [] },
  ];
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`insert into auth.users (id, email) values ($1,'h@x'),($2,'a@x'),($3,'b@x'),($4,'s@x')`, [HOST, ANA, BEN, STRANGER]);
  const s = await as(db, HOST, () =>
    one<{ id: string; join_code: string }>(`insert into public.sessions (host_id, title) values ($1, 'Dinner') returning id, join_code`, [HOST]),
  );
  sessionId = s.id;
  await as(db, ANA, () => db.query(`select public.join_session($1)`, [s.join_code]));
  await as(db, BEN, () => db.query(`select public.join_session($1)`, [s.join_code]));
  const ps = await db.query<{ id: string; user_id: string }>(`select id, user_id from public.participants where session_id = $1`, [sessionId]);
  pid.host = ps.rows.find((r) => r.user_id === HOST)!.id;
  pid.ana = ps.rows.find((r) => r.user_id === ANA)!.id;
  pid.ben = ps.rows.find((r) => r.user_id === BEN)!.id;
  item.latte = (await as(db, ANA, () =>
    one<{ id: string }>(`select public.add_order_item($1, 'Latte', 20000, 1, '', false, $2) as id`, [sessionId, [pid.ana]]),
  )).id;
  item.nachos = (await as(db, HOST, () =>
    one<{ id: string }>(`select public.add_order_item($1, 'Nachos', 30000, 1, '', true, $2) as id`, [sessionId, [pid.host, pid.ana, pid.ben]]),
  )).id;
}, 60_000);

describe("receipt editing", () => {
  it("only the host can create and edit the receipt", async () => {
    await expect(
      as(db, ANA, () => db.query(`insert into public.receipts (session_id) values ($1)`, [sessionId])),
    ).rejects.toThrow(/row-level security/);
    receiptId = (await as(db, HOST, () =>
      one<{ id: string }>(`insert into public.receipts (session_id) values ($1) returning id`, [sessionId]),
    )).id;
    await as(db, HOST, async () => {
      await db.query(`update public.receipts set service_charge_centavos = 5000 where id = $1`, [receiptId]);
      line.latte = (await one<{ id: string }>(
        `insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos) values ($1, $2, 'LATTE', 20000) returning id`,
        [receiptId, sessionId],
      )).id;
      line.nachos = (await one<{ id: string }>(
        `insert into public.receipt_lines (receipt_id, session_id, description, amount_centavos) values ($1, $2, 'NACHOS', 30000) returning id`,
        [receiptId, sessionId],
      )).id;
      await db.query(`insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id) values ($1, $2, $3)`, [line.latte, item.latte, sessionId]);
    });
    const upd = await as(db, ANA, () => db.query(`update public.receipt_lines set amount_centavos = 1 returning id`));
    expect(upd.rows).toHaveLength(0);
  });

  it("members see the receipt; strangers don't", async () => {
    expect((await as(db, BEN, () => db.query(`select 1 from public.receipt_lines`))).rows).toHaveLength(2);
    expect((await as(db, STRANGER, () => db.query(`select 1 from public.receipts`))).rows).toHaveLength(0);
  });

  it("lines can't link to items from another table", async () => {
    const other = await as(db, STRANGER, () =>
      one<{ id: string }>(`insert into public.sessions (host_id, title) values ($1, 'Other') returning id`, [STRANGER]),
    );
    const sp = await one<{ id: string }>(`select id from public.participants where session_id = $1`, [other.id]);
    const foreign = await as(db, STRANGER, () =>
      one<{ id: string }>(`select public.add_order_item($1, 'X', 100, 1, '', false, $2) as id`, [other.id, [sp.id]]),
    );
    await expect(
      as(db, HOST, () =>
        db.query(`insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id) values ($1, $2, $3)`, [line.nachos, foreign.id, sessionId]),
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("sending the bill", () => {
  it("refuses while a line has nobody to pay for it", async () => {
    await expect(
      as(db, HOST, () => db.query(`select public.finalize_bill($1, $2)`, [sessionId, JSON.stringify(goodShares())])),
    ).rejects.toThrow(/aren't assigned/);
    await as(db, HOST, () =>
      db.query(`insert into public.receipt_line_items (receipt_line_id, order_item_id, session_id) values ($1, $2, $3)`, [line.nachos, item.nachos, sessionId]),
    );
  });

  it("refuses shares that don't add up to the receipt", async () => {
    const bad = goodShares();
    bad[0].items_centavos += 1;
    bad[0].total_centavos += 1;
    await expect(
      as(db, HOST, () => db.query(`select public.finalize_bill($1, $2)`, [sessionId, JSON.stringify(bad)])),
    ).rejects.toThrow(/don't add up/);
    const inconsistent = goodShares();
    inconsistent[1].total_centavos = 1;
    await expect(
      as(db, HOST, () => db.query(`select public.finalize_bill($1, $2)`, [sessionId, JSON.stringify(inconsistent)])),
    ).rejects.toThrow(/check constraint/);
  });

  it("only the host can send it", async () => {
    await expect(
      as(db, ANA, () => db.query(`select public.finalize_bill($1, $2)`, [sessionId, JSON.stringify(goodShares())])),
    ).rejects.toThrow(/Only the host/);
  });

  it("stores shares, copies the host's payment QR, locks the receipt, and moves the table to billing", async () => {
    await as(db, HOST, () => db.query(`update public.profiles set payment_qr_path = 'qr/host.png', payment_qr_label = 'GCash'`));
    await as(db, HOST, () => db.query(`select public.finalize_bill($1, $2)`, [sessionId, JSON.stringify(goodShares())]));
    const r = await one<{ status: string; payment_qr_path: string; payment_qr_label: string }>(
      `select status, payment_qr_path, payment_qr_label from public.receipts where id = $1`,
      [receiptId],
    );
    expect(r).toEqual({ status: "final", payment_qr_path: "qr/host.png", payment_qr_label: "GCash" });
    expect((await one<{ status: string }>(`select status from public.sessions where id = $1`, [sessionId])).status).toBe("billing");
    expect((await as(db, BEN, () => db.query(`select 1 from public.bill_shares`))).rows).toHaveLength(3);
    const edit = await as(db, HOST, () => db.query(`update public.receipt_lines set amount_centavos = 1 returning id`));
    expect(edit.rows).toHaveLength(0);
  });
});

describe("settling up", () => {
  it("people mark their own payment only", async () => {
    await as(db, ANA, () => db.query(`select public.mark_paid($1, $2, true)`, [sessionId, pid.ana]));
    await expect(
      as(db, ANA, () => db.query(`select public.mark_paid($1, $2, true)`, [sessionId, pid.ben])),
    ).rejects.toThrow(/your own payment/);
    await expect(
      as(db, HOST, () => db.query(`select public.mark_paid($1, $2, true)`, [sessionId, pid.host])),
    ).rejects.toThrow(/doesn't pay themselves/);
    await expect(
      as(db, STRANGER, () => db.query(`select public.mark_paid($1, $2, true)`, [sessionId, pid.ana])),
    ).rejects.toThrow(/your own payment/);
  });

  it("the host confirms; after that, the person can't untick", async () => {
    await expect(
      as(db, ANA, () => db.query(`select public.confirm_payment($1, $2, true)`, [sessionId, pid.ana])),
    ).rejects.toThrow(/Only the host/);
    await as(db, HOST, () => db.query(`select public.confirm_payment($1, $2, true)`, [sessionId, pid.ana]));
    await expect(
      as(db, ANA, () => db.query(`select public.mark_paid($1, $2, false)`, [sessionId, pid.ana])),
    ).rejects.toThrow(/already confirmed/);
    // Cash: host confirms Ben directly.
    await as(db, HOST, () => db.query(`select public.confirm_payment($1, $2, true)`, [sessionId, pid.ben]));
    const p = await as(db, BEN, () => db.query(`select participant_id from public.payments where confirmed_at is not null`));
    expect(p.rows).toHaveLength(2);
  });

  it("reopening the bill clears shares and payments and unlocks the receipt", async () => {
    await expect(as(db, ANA, () => db.query(`select public.reopen_bill($1)`, [sessionId]))).rejects.toThrow(/Only the host/);
    await as(db, HOST, () => db.query(`select public.reopen_bill($1)`, [sessionId]));
    expect((await db.query(`select 1 from public.bill_shares where session_id = $1`, [sessionId])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.payments where session_id = $1`, [sessionId])).rows).toHaveLength(0);
    expect((await one<{ status: string }>(`select status from public.receipts where id = $1`, [receiptId])).status).toBe("review");
    expect((await one<{ status: string }>(`select status from public.sessions where id = $1`, [sessionId])).status).toBe("closed");
  });
});

describe("storage", () => {
  it("receipt photos: host uploads, members read, others can't", async () => {
    await as(db, HOST, () => db.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${sessionId}/r1.jpg`]));
    await expect(
      as(db, ANA, () => db.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${sessionId}/r2.jpg`])),
    ).rejects.toThrow(/row-level security/);
    expect((await as(db, BEN, () => db.query(`select 1 from storage.objects where bucket_id = 'receipts'`))).rows).toHaveLength(1);
    expect((await as(db, STRANGER, () => db.query(`select 1 from storage.objects where bucket_id = 'receipts'`))).rows).toHaveLength(0);
  });

  it("payment QR codes go only into your own folder", async () => {
    await as(db, ANA, () => db.query(`insert into storage.objects (bucket_id, name) values ('payment-qr', $1)`, [`${ANA}/qr.png`]));
    await expect(
      as(db, ANA, () => db.query(`insert into storage.objects (bucket_id, name) values ('payment-qr', $1)`, [`${BEN}/qr.png`])),
    ).rejects.toThrow(/row-level security/);
  });
});
