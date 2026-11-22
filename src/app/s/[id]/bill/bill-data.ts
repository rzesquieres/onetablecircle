import { computeBill, type Adjustment, type BillLine, type BillResult } from "@/lib/bill";
import type { TableData } from "../use-table";

/** Turn the table's receipt rows into the pure bill engine's input and run it. */
export function billFor(data: TableData): BillResult {
  const r = data.receipt;
  const lines: BillLine[] = data.lines.map((l) => ({
    id: l.id,
    description: l.description,
    amount: l.amount_centavos,
    split: l.split,
    itemIds: data.lineItems.filter((x) => x.receipt_line_id === l.id).map((x) => x.order_item_id),
    people: data.linePeople
      .filter((x) => x.receipt_line_id === l.id)
      .map((x) => ({ participantId: x.participant_id, weight: x.weight })),
  }));
  return computeBill({
    participants: data.participants,
    items: data.items,
    assignees: data.assignees,
    lines,
    charges: {
      service: r?.service_charge_centavos ?? 0,
      tax: r?.tax_centavos ?? 0,
      discount: r?.discount_centavos ?? 0,
      tip: r?.tip_centavos ?? 0,
      scPwdDiscount: r?.sc_pwd_discount_centavos ?? 0,
      serviceSplit: r?.service_split ?? "ordered",
      tipSplit: r?.tip_split ?? "ordered",
    },
  });
}

/** Payload for finalize_bill(). */
export function sharesPayload(result: BillResult) {
  return result.shares.map((s) => ({
    participant_id: s.participantId,
    items_centavos: s.items,
    service_centavos: s.service,
    tax_centavos: s.tax,
    discount_centavos: s.discount,
    sc_pwd_discount_centavos: s.scPwdDiscount,
    covered_centavos: s.covered,
    covering_centavos: s.covering,
    adjustments: s.adjustments,
    tip_centavos: s.tip,
    total_centavos: s.total,
    breakdown: s.breakdown,
  }));
}

/**
 * Breakdown rows for treats and celebrants (OTC-33), e.g. "Covered by Ana −₱300",
 * "For Ben +₱300", "Carl's celebration +₱133.33". A celebrant's many "out"
 * moves show as one line.
 */
export function adjustmentRows(adjustments: Adjustment[] | undefined, name: (pid: string) => string): { label: string; value: number }[] {
  const rows: { label: string; value: number }[] = [];
  const celebrated = (adjustments ?? []).filter((a) => a.kind === "celebrant" && a.direction === "out").reduce((t, a) => t + a.amount, 0);
  if (celebrated) rows.push({ label: "🎂 Covered by everyone", value: -celebrated });
  for (const a of adjustments ?? []) {
    if (a.kind === "celebrant" && a.direction === "out") continue;
    if (a.kind === "celebrant") rows.push({ label: `🎂 ${name(a.participantId)}'s share`, value: a.amount });
    else if (a.direction === "out") rows.push({ label: `Covered by ${name(a.participantId)}`, value: -a.amount });
    else rows.push({ label: `For ${name(a.participantId)} (libre)`, value: a.amount });
  }
  return rows;
}
