import { computeBill, type BillLine, type BillResult } from "@/lib/bill";
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
    tip_centavos: s.tip,
    total_centavos: s.total,
    breakdown: s.breakdown,
  }));
}
