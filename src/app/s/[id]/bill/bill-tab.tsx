"use client";

import { Card, Notice } from "@/components/ui";
import { itemsFor, optionsText } from "@/lib/consolidate";
import { formatMoney } from "@/lib/money";
import type { TabProps } from "../tab-props";
import { BillSummary } from "./bill-summary";
import { HostBillStart } from "./host-bill-start";
import { ReceiptEditor } from "./receipt-editor";

export function BillTab(props: TabProps) {
  const { data, isHost } = props;
  const receipt = data.receipt;

  if (receipt?.status === "final") return <BillSummary {...props} />;
  if (!isHost) return <WaitingForBill {...props} />;
  if (!receipt || receipt.status === "failed" || receipt.status === "scanning") return <HostBillStart {...props} />;
  return <ReceiptEditor {...props} />;
}

/** Guests before the bill is sent: what they ordered, and a rough running total. */
function WaitingForBill({ data, me }: TabProps) {
  const mine = itemsFor(me.id, data.items, data.assignees, data.events);
  const priced = mine.filter((m) => m.item.unit_price_centavos !== null);
  const estimate = priced.reduce(
    (sum, m) => sum + Math.round(((m.item.unit_price_centavos ?? 0) * m.item.quantity) / m.sharedWith),
    0,
  );
  const scanning = data.receipt?.status === "scanning" || data.receipt?.status === "review";
  return (
    <div className="flex flex-col gap-4">
      <Notice>
        {scanning
          ? "The host is checking the receipt. Your share will appear here when they send the bill."
          : "When you're done, the host scans the receipt and sends everyone their share here."}
      </Notice>
      {mine.length > 0 && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Your items so far</p>
          <ul className="flex flex-col gap-1 text-sm">
            {mine.map(({ item, sharedWith }) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>
                  {item.quantity}× {item.name}
                  {optionsText(item) && <span className="text-ink-soft"> ({optionsText(item)})</span>}
                  {sharedWith > 1 && <span className="text-ink-soft"> · ÷{sharedWith}</span>}
                </span>
                <span className="tabular-nums">
                  {item.unit_price_centavos === null ? "—" : formatMoney(Math.round((item.unit_price_centavos * item.quantity) / sharedWith))}
                </span>
              </li>
            ))}
          </ul>
          {priced.length > 0 && (
            <p className="border-t border-line pt-2 text-sm">
              Rough estimate: <span className="font-semibold">{formatMoney(estimate)}</span>{" "}
              <span className="text-ink-soft">before service charge. The receipt decides the final amount.</span>
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
