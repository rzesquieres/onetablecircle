"use client";

import { useState, type FormEvent } from "react";
import { Button, Input, Label, Notice } from "@/components/ui";
import { parseMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { ForWhom, QtyStepper, useForWhom } from "./for-whom";
import type { TabProps } from "./tab-props";

/** "Other item": anything typed by hand, with an optional price. */
export function FreeTextForm({ data, me, reload, compact }: Pick<TabProps, "data" | "me" | "reload"> & { compact?: boolean }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const who = useForWhom(data.participants, me.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setAdded("");
    const priceCentavos = price.trim() ? parseMoney(price) : null;
    if (price.trim() && (priceCentavos === null || priceCentavos < 0)) return setError("Price should look like 180 or 180.50.");
    if (who.forIds.length === 0) return setError("Choose who this is for.");
    setBusy(true);
    const { error } = await getSupabase().rpc("add_order_item", {
      p_session_id: data.session.id,
      p_name: name,
      p_unit_price_centavos: priceCentavos,
      p_quantity: qty,
      p_notes: notes,
      p_is_shared: who.shared,
      p_assignee_ids: who.forIds,
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setAdded(`Added ${qty}× ${name.trim()}`);
    setName("");
    setPrice("");
    setQty(1);
    setNotes("");
    who.reset();
    void reload();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="item">{compact ? "Item not on the menu" : "What are you ordering?"}</Label>
        <Input id="item" required maxLength={120} placeholder="e.g. Iced latte" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <Label htmlFor="price">Price each (optional)</Label>
          <Input id="price" inputMode="decimal" placeholder="₱0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <Label>Qty</Label>
          <QtyStepper value={qty} onChange={setQty} />
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input id="notes" maxLength={200} placeholder="e.g. less ice" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <ForWhom state={who} people={data.participants} meId={me.id} sessionId={data.session.id} onPersonAdded={reload} />
      {error && <Notice tone="error">{error}</Notice>}
      {added && <Notice>{added} ✓</Notice>}
      <Button type="submit" disabled={busy} className="min-h-14 text-lg">
        {busy ? "Adding…" : "Add to order"}
      </Button>
    </form>
  );
}
