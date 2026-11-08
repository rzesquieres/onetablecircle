"use client";

import { itemsFor, optionsText } from "@/lib/consolidate";
import { Card } from "@/components/ui";
import type { TabProps } from "./tab-props";

export function MineTab({ data, me }: TabProps) {
  const mine = itemsFor(me.id, data.items, data.assignees, data.events);
  const pending = mine.filter((m) => m.served < m.item.quantity);

  if (mine.length === 0) return <p className="text-ink-soft">You haven&apos;t got any items yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-semibold">
        {pending.length === 0 ? "All your items have arrived 🎉" : `${pending.length} of your item${pending.length === 1 ? "" : "s"} still coming`}
      </p>
      <ul className="flex flex-col gap-2">
        {mine.map(({ item, served, sharedWith }) => {
          const done = served >= item.quantity;
          return (
            <li key={item.id}>
              <Card className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {item.quantity}× {item.name}
                  </p>
                  {optionsText(item) && <p className="text-sm">{optionsText(item)}</p>}
                  <p className="text-sm text-ink-soft">
                    {item.notes ? `${item.notes} · ` : ""}
                    {sharedWith > 1 ? `Shared by ${sharedWith}` : "Just you"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    done ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"
                  }`}
                >
                  {done ? "Served" : item.quantity > 1 ? `${served} of ${item.quantity} served` : "Waiting"}
                </span>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-soft">Your share of the bill is worked out after the meal, from the receipt.</p>
    </div>
  );
}
