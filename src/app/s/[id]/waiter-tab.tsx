"use client";

import { useMemo, useState } from "react";
import { Chip, Notice } from "@/components/ui";
import { pickItemForTick, servedCounts, type ConsolidatedLine } from "@/lib/consolidate";
import { isActive } from "@/lib/session-rules";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { nameOf, timeOf, type TabProps } from "./tab-props";

export function WaiterTab({ data, me, lines, reload }: TabProps) {
  const [filter, setFilter] = useState<"all" | "waiting">("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const served = useMemo(() => servedCounts(data.items, data.events), [data.items, data.events]);
  const canTick = isActive(data.session);
  const waiting = lines.filter((l) => l.served < l.quantity);
  const shown = filter === "waiting" ? waiting : lines;

  async function tick(line: ConsolidatedLine, delta: 1 | -1) {
    const itemId = pickItemForTick(line, served, delta);
    if (!itemId) return;
    setBusyKey(line.key);
    setError("");
    const { error } = await getSupabase()
      .from("delivery_events")
      .insert({ order_item_id: itemId, delta, by_participant_id: me.id });
    setBusyKey(null);
    if (error) setError(friendlyError(error));
    void reload();
  }

  if (lines.length === 0) return <p className="text-ink-soft">Nothing ordered yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Chip selected={filter === "all"} onClick={() => setFilter("all")}>All ({lines.length})</Chip>
        <Chip selected={filter === "waiting"} onClick={() => setFilter("waiting")}>Still waiting ({waiting.length})</Chip>
      </div>
      {!canTick && <Notice>Billing has started, so items can no longer be ticked.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {shown.length === 0 ? (
        <Notice>Everything has been served. 🎉</Notice>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((line) => {
            const remaining = line.quantity - line.served;
            const qtyShown = filter === "waiting" ? remaining : line.quantity;
            const done = remaining === 0;
            const itemIds = new Set(line.items.map((i) => i.id));
            const history = data.events.filter((e) => itemIds.has(e.order_item_id));
            const busy = busyKey === line.key;
            return (
              <li key={line.key} className={`rounded-2xl border bg-surface ${done ? "border-ok/40" : "border-line"}`}>
                <div className="flex items-center gap-3 p-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setOpenKey(openKey === line.key ? null : line.key)}
                    aria-expanded={openKey === line.key}
                  >
                    <p className={`text-lg font-semibold leading-snug ${done ? "text-ink-soft line-through" : ""}`}>
                      <span className="tabular-nums">{qtyShown}×</span> {line.name}
                    </p>
                    {line.optionsText && <p className="text-sm font-medium text-ink">{line.optionsText}</p>}
                    {line.notes && <p className="text-sm text-ink">{line.notes}</p>}
                    <p className="text-xs text-ink-soft">
                      {line.isShared ? "Shared · " : ""}
                      {line.participantIds.map((pid) => nameOf(data, pid)).join(", ")}
                    </p>
                  </button>

                  {line.quantity === 1 ? (
                    <button
                      disabled={!canTick || busy}
                      onClick={() => tick(line, done ? -1 : 1)}
                      aria-label={done ? `Untick ${line.name}` : `Mark ${line.name} served`}
                      className={`flex size-12 shrink-0 items-center justify-center rounded-xl border-2 text-2xl disabled:opacity-50 ${
                        done ? "border-ok bg-ok text-white" : "border-line"
                      }`}
                    >
                      {done ? "✓" : ""}
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        disabled={!canTick || busy || line.served === 0}
                        onClick={() => tick(line, -1)}
                        aria-label={`Untick one ${line.name}`}
                        className="size-11 rounded-xl border border-line text-xl disabled:opacity-30"
                      >
                        −
                      </button>
                      <span className={`w-12 text-center text-sm font-semibold tabular-nums ${done ? "text-ok" : ""}`}>
                        {line.served}/{line.quantity}
                      </span>
                      <button
                        disabled={!canTick || busy || done}
                        onClick={() => tick(line, 1)}
                        aria-label={`Mark one ${line.name} served`}
                        className="size-11 rounded-xl bg-ok text-xl text-white disabled:opacity-30"
                      >
                        ✓
                      </button>
                    </div>
                  )}
                </div>
                {openKey === line.key && (
                  <div className="border-t border-line px-3 py-2 text-xs text-ink-soft">
                    {history.length === 0 ? (
                      <p>Not ticked yet.</p>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {history.map((e) => (
                          <li key={e.id}>
                            {e.delta > 0 ? "✓ Served" : "↺ Unticked"} by {nameOf(data, e.by_participant_id)} at {timeOf(e.created_at)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-center text-xs text-ink-soft">Tap an item to see who ticked it and when.</p>
    </div>
  );
}
