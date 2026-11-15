"use client";

import { useState, type FormEvent } from "react";
import { Button, Input, Label, Notice } from "@/components/ui";
import { editChangesItem, editProblem } from "@/lib/session-rules";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import type { OrderItem } from "@/lib/types";
import { ForWhom, QtyStepper, useForWhom } from "./for-whom";
import { nameOf, type TabProps } from "./tab-props";

/**
 * OTC-27: change an order after it's placed — make it shared or not, who
 * shares it, how many, and the note. Shown only to the person who ordered it
 * and the table's creator; the database enforces the same rule.
 */
export function EditItemForm({
  item,
  data,
  me,
  reload,
  onDone,
}: Pick<TabProps, "data" | "me" | "reload"> & { item: OrderItem; onDone: () => void }) {
  const currentForIds = data.assignees.filter((a) => a.order_item_id === item.id).map((a) => a.participant_id);
  const who = useForWhom(data.participants, me.id, { shared: item.is_shared, forIds: currentForIds });
  const [qty, setQty] = useState(item.quantity);
  const [notes, setNotes] = useState(item.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const next = { quantity: qty, notes, isShared: who.shared, forIds: who.forIds };
  const changed = editChangesItem(item, currentForIds, next);
  const someoneElses = item.added_by !== me.id;
  const billSent = data.session.status === "billing";

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!changed) return onDone();
    const problem = editProblem(next);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    // The database checks who may edit and that the bill isn't paid, takes a
    // sent bill back, and tells the orderer when the host edits their item.
    const { error } = await getSupabase().rpc("edit_order_item", {
      p_item_id: item.id,
      p_quantity: qty,
      p_notes: notes,
      p_is_shared: who.shared,
      p_assignee_ids: who.forIds,
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    void reload();
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 border-t border-line pt-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label htmlFor={`notes-${item.id}`}>Notes</Label>
          <Input
            id={`notes-${item.id}`}
            maxLength={200}
            placeholder="e.g. less ice"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div>
          <Label>Qty</Label>
          <QtyStepper value={qty} onChange={setQty} />
        </div>
      </div>
      <ForWhom state={who} people={data.participants} meId={me.id} sessionId={data.session.id} onPersonAdded={reload} />
      {changed && (someoneElses || billSent) && (
        <p className="text-xs text-ink-soft">
          {someoneElses ? `${nameOf(data, item.added_by)} will be told in the app. ` : ""}
          {billSent ? "The bill goes back to the host to send again." : ""}
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={busy || !changed}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
