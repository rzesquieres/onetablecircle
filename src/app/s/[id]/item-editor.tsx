"use client";

import { useState } from "react";
import { Button, Chip, Input, Label, Notice } from "@/components/ui";
import { allocate } from "@/lib/bill";
import { formatMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import type { OrderItem } from "@/lib/types";
import type { TableData } from "./use-table";

const MAX_PORTIONS = 10;
const MAX_QUANTITY = 99;

/**
 * Edit an item after it's been ordered (OTC-27): quantity, notes, and who
 * shares it with portions (OTC-32, e.g. Ana had 2 slices, Ben had 1). The
 * database checks who may change it, takes a sent bill back if needed, and
 * tells the orderer when the host changed their item (edit_order_item).
 */
export function ItemEditor({
  item,
  data,
  meId,
  onDone,
}: {
  item: OrderItem;
  data: TableData;
  meId: string;
  onDone: (saved: boolean) => void;
}) {
  const current = data.assignees.filter((a) => a.order_item_id === item.id);
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      current.map((a) => [a.participant_id, a.share_weight || 1]),
    ),
  );
  const [quantity, setQuantity] = useState(item.quantity);
  const [notes, setNotes] = useState(item.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Participants in table order, so the preview rounds like the bill does.
  const people = data.participants;
  const chosen = people.filter((p) => weights[p.id]);
  const shared = chosen.length > 1;
  const total =
    item.unit_price_centavos === null
      ? null
      : item.unit_price_centavos * quantity;
  const preview =
    total !== null && chosen.length
      ? allocate(
          total,
          chosen.map((p) => weights[p.id]),
        )
      : null;
  const billSent = data.session.status === "billing";
  const someoneElses = item.added_by !== meId;
  const ordererName =
    data.participants.find((p) => p.id === item.added_by)?.display_name ??
    "They";

  const toggle = (pid: string) =>
    setWeights((w) => {
      const next = { ...w };
      if (next[pid]) delete next[pid];
      else next[pid] = 1;
      return next;
    });
  const setPortion = (pid: string, n: number) =>
    setWeights((w) => ({
      ...w,
      [pid]: Math.min(MAX_PORTIONS, Math.max(1, n)),
    }));
  const evenOut = () =>
    setWeights((w) => Object.fromEntries(Object.keys(w).map((k) => [k, 1])));
  const uneven = shared && chosen.some((p) => weights[p.id] !== 1);

  async function save() {
    if (!chosen.length || busy) return;
    setBusy(true);
    setError("");
    const { error } = await getSupabase().rpc("edit_order_item", {
      p_item_id: item.id,
      p_quantity: quantity,
      p_notes: notes.trim(),
      p_people: chosen.map((p) => ({
        participant_id: p.id,
        weight: shared ? weights[p.id] : 1,
      })),
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onDone(true);
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex items-end gap-3">
        <div>
          <Label>Quantity</Label>
          <div className="flex h-12 items-center rounded-xl border border-line bg-surface">
            <button
              type="button"
              aria-label="Fewer"
              className="h-full w-11 text-xl disabled:opacity-30"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              aria-label="More"
              className="h-full w-11 text-xl disabled:opacity-30"
              disabled={quantity >= MAX_QUANTITY}
              onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
            >
              +
            </button>
          </div>
        </div>
        {total !== null && (
          <p className="pb-3 text-sm tabular-nums text-ink-soft">
            {formatMoney(total, data.session.currency)}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor={`notes-${item.id}`}>Notes</Label>
        <Input
          id={`notes-${item.id}`}
          value={notes}
          maxLength={200}
          placeholder="e.g. no onions, extra rice"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div>
        <Label>Who&apos;s sharing this?</Label>
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <Chip
              key={p.id}
              selected={Boolean(weights[p.id])}
              onClick={() => toggle(p.id)}
            >
              {p.id === meId ? "Me" : p.display_name}
            </Chip>
          ))}
        </div>
      </div>

      {shared && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Portions</Label>
            {uneven && (
              <button
                type="button"
                className="min-h-11 text-sm font-medium text-brand"
                onClick={evenOut}
              >
                Split evenly
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {chosen.map((p, i) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  {p.id === meId ? "Me" : p.display_name}
                </span>
                <div className="flex items-center gap-2">
                  {preview && (
                    <span className="text-sm tabular-nums text-ink-soft">
                      {formatMoney(preview[i], data.session.currency)}
                    </span>
                  )}
                  <div className="flex h-11 items-center rounded-xl border border-line bg-surface">
                    <button
                      type="button"
                      aria-label={`Fewer portions for ${p.display_name}`}
                      className="h-full w-10 text-xl disabled:opacity-30"
                      disabled={weights[p.id] <= 1}
                      onClick={() => setPortion(p.id, weights[p.id] - 1)}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-semibold tabular-nums">
                      {weights[p.id]}
                    </span>
                    <button
                      type="button"
                      aria-label={`More portions for ${p.display_name}`}
                      className="h-full w-10 text-xl disabled:opacity-30"
                      disabled={weights[p.id] >= MAX_PORTIONS}
                      onClick={() => setPortion(p.id, weights[p.id] + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-soft">
            {uneven
              ? "Split by portions."
              : `Split evenly between ${chosen.length} people.`}{" "}
            Service charge and tip follow each person&apos;s share.
          </p>
        </div>
      )}

      {!chosen.length && <Notice tone="warn">Pick at least one person.</Notice>}
      {(billSent || someoneElses) && (
        <p className="text-xs text-ink-soft">
          {someoneElses ? `${ordererName} will be told in the app. ` : ""}
          {billSent ? "The bill goes back to the host to send again." : ""}
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy || !chosen.length}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
