"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, Chip, Input, Label, Notice } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { isActive } from "@/lib/session-rules";
import { nameOf, type TabProps } from "./tab-props";

export function OrderTab({ data, me, isHost, ordersOpen, reload }: TabProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [shared, setShared] = useState(false);
  const [forIds, setForIds] = useState<string[]>([me.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  const people = data.participants;
  const currency = data.session.currency;

  function pick(pid: string) {
    if (!shared) return setForIds([pid]);
    setForIds((ids) => (ids.includes(pid) ? ids.filter((x) => x !== pid) : [...ids, pid]));
  }

  function toggleShared() {
    const next = !shared;
    setShared(next);
    setForIds(next ? people.map((p) => p.id) : [me.id]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setAdded("");
    const priceCentavos = price.trim() ? parseMoney(price) : null;
    if (price.trim() && (priceCentavos === null || priceCentavos < 0)) {
      setError("Price should look like 180 or 180.50.");
      return;
    }
    if (forIds.length === 0) {
      setError("Choose who this is for.");
      return;
    }
    setBusy(true);
    const { error } = await getSupabase().rpc("add_order_item", {
      p_session_id: data.session.id,
      p_name: name,
      p_unit_price_centavos: priceCentavos,
      p_quantity: qty,
      p_notes: notes,
      p_is_shared: shared,
      p_assignee_ids: forIds,
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setAdded(`Added ${qty}× ${name.trim()}`);
    setName("");
    setPrice("");
    setQty(1);
    setNotes("");
    setShared(false);
    setForIds([me.id]);
    void reload();
  }

  // Two taps to remove: the first arms the button, the second deletes.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function remove(itemId: string) {
    if (confirmId !== itemId) {
      setConfirmId(itemId);
      return;
    }
    setConfirmId(null);
    setError("");
    const { data: deleted, error } = await getSupabase().from("order_items").delete().eq("id", itemId).select("id");
    if (error) setError(friendlyError(error));
    else if (!deleted?.length) setError("Couldn't remove that item. Ordering may have closed.");
    void reload();
  }

  const canEdit = (addedBy: string) =>
    (addedBy === me.id && ordersOpen) || (isHost && isActive(data.session));

  const items = [...data.items].reverse();

  return (
    <div className="flex flex-col gap-6">
      {ordersOpen ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="item">What are you ordering?</Label>
            <Input id="item" required maxLength={120} placeholder="e.g. Iced latte" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="price">Price each (optional)</Label>
              <Input id="price" inputMode="decimal" placeholder="₱0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label>Qty</Label>
              <div className="flex h-12 items-center rounded-xl border border-line bg-surface">
                <button type="button" aria-label="Less" className="h-full w-11 text-xl" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <span className="w-7 text-center font-semibold tabular-nums">{qty}</span>
                <button type="button" aria-label="More" className="h-full w-11 text-xl" onClick={() => setQty((q) => Math.min(99, q + 1))}>+</button>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" maxLength={200} placeholder="e.g. less ice, oat milk" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>{shared ? "Shared by" : "For"}</Label>
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-5 accent-brand" checked={shared} onChange={toggleShared} />
                Shared item
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <Chip key={p.id} selected={forIds.includes(p.id)} onClick={() => pick(p.id)}>
                  {p.id === me.id ? "Me" : p.display_name}
                </Chip>
              ))}
            </div>
            {shared && (
              <p className="mt-1 text-xs text-ink-soft">Split evenly between {forIds.length} {forIds.length === 1 ? "person" : "people"}.</p>
            )}
          </div>

          {error && <Notice tone="error">{error}</Notice>}
          {added && <Notice>{added} ✓</Notice>}
          <Button type="submit" disabled={busy} className="min-h-14 text-lg">
            {busy ? "Adding…" : "Add to order"}
          </Button>
        </form>
      ) : (
        <Notice tone="warn">Ordering is closed for this table.{isHost ? " You can reopen it in the Host tab." : ""}</Notice>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Everyone&apos;s items ({data.items.length})
        </h2>
        {items.length === 0 ? (
          <p className="text-ink-soft">Nothing ordered yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const forPids = data.assignees.filter((a) => a.order_item_id === item.id).map((a) => a.participant_id);
              const forNames = forPids.map((pid) => (pid === me.id ? "you" : nameOf(data, pid)));
              const showAddedBy = item.is_shared || forPids[0] !== item.added_by;
              return (
                <li key={item.id}>
                  <Card className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {item.quantity}× {item.name}
                      </p>
                      {item.notes && <p className="text-sm text-ink-soft">{item.notes}</p>}
                      <p className="text-sm text-ink-soft">
                        {item.is_shared ? `Shared: ${forNames.join(", ")}` : `For ${forNames.join(", ")}`}
                        {showAddedBy ? ` · added by ${item.added_by === me.id ? "you" : nameOf(data, item.added_by)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm tabular-nums">
                        {item.unit_price_centavos === null ? "—" : formatMoney(item.unit_price_centavos * item.quantity, currency)}
                      </span>
                      {canEdit(item.added_by) &&
                        (confirmId === item.id ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setConfirmId(null)}>
                              Keep
                            </Button>
                            <Button
                              className="min-h-9 bg-danger px-2 text-sm active:bg-danger"
                              onClick={() => remove(item.id)}
                            >
                              {item.added_by === me.id ? "Remove" : `Remove ${nameOf(data, item.added_by)}'s`}
                            </Button>
                          </div>
                        ) : (
                          <Button variant="danger" className="min-h-9 px-2 text-sm" onClick={() => remove(item.id)}>
                            Remove
                          </Button>
                        ))}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
