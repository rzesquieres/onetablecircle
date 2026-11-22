"use client";

import { useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { optionsText } from "@/lib/consolidate";
import { formatMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { canRemoveItem } from "@/lib/session-rules";
import { FreeTextForm } from "./free-text-form";
import { MenuPicker } from "./menu-picker";
import { ShareEditor } from "./share-editor";
import { nameOf, type TabProps } from "./tab-props";

export function OrderTab(props: TabProps) {
  const { data, me, isHost, ordersOpen, reload, menu } = props;
  const [showOther, setShowOther] = useState(false);
  const [error, setError] = useState("");
  // Two taps to remove: the first arms the button, the second deletes.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // OTC-32: the item whose sharing is being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const currency = data.session.currency;
  const hasStore = Boolean(data.session.store_id);

  async function remove(itemId: string) {
    if (confirmId !== itemId) return setConfirmId(itemId);
    setConfirmId(null);
    setError("");
    // The database checks who may remove it and that the bill isn't paid, and
    // tells the person who ordered it when the host removes it (OTC-25).
    const { error } = await getSupabase().rpc("remove_order_item", { p_item_id: itemId });
    if (error) setError(friendlyError(error));
    void reload();
  }

  const canEdit = (addedBy: string) => canRemoveItem(data.session, data.payments, addedBy, { id: me.id, isHost });
  // Removing an item after the bill was sent takes the bill back to be redone.
  const billSent = data.session.status === "billing";
  const items = [...data.items].reverse();

  return (
    <div className="flex flex-col gap-6">
      {!ordersOpen ? (
        <Notice tone="warn">Ordering is closed for this table.{isHost ? " You can reopen it in the Host tab." : ""}</Notice>
      ) : hasStore ? (
        <>
          {menu ? <MenuPicker data={data} me={me} reload={reload} menu={menu} /> : <Notice>Loading the menu…</Notice>}
          <div className="rounded-2xl border border-dashed border-line p-3">
            {showOther ? (
              <FreeTextForm data={data} me={me} reload={reload} compact />
            ) : (
              <Button variant="ghost" className="w-full" onClick={() => setShowOther(true)}>
                + Other item (not on the menu)
              </Button>
            )}
          </div>
        </>
      ) : (
        <FreeTextForm data={data} me={me} reload={reload} />
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Everyone&apos;s items ({data.items.length})
        </h2>
        {items.length === 0 ? (
          <p className="text-ink-soft">Nothing ordered yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const forRows = data.assignees.filter((a) => a.order_item_id === item.id);
              const forPids = forRows.map((a) => a.participant_id);
              const uneven = forRows.some((a) => (a.share_weight || 1) !== (forRows[0]?.share_weight || 1));
              const forNames = forRows.map(
                (a) => (a.participant_id === me.id ? "you" : nameOf(data, a.participant_id)) + (uneven ? ` ×${a.share_weight || 1}` : ""),
              );
              const editing = editingId === item.id;
              const showAddedBy = item.is_shared || forPids[0] !== item.added_by;
              const opts = optionsText(item);
              return (
                <li key={item.id}>
                  <Card className="py-3">
                    <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {item.quantity}× {item.name}
                      </p>
                      {opts && <p className="text-sm">{opts}</p>}
                      {item.notes && <p className="text-sm text-ink-soft">{item.notes}</p>}
                      <p className="text-sm text-ink-soft">
                        {item.is_shared ? `Shared: ${forNames.join(", ")}` : `For ${forNames.join(", ")}`}
                        {showAddedBy ? ` · added by ${item.added_by === me.id ? "you" : nameOf(data, item.added_by)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm tabular-nums">
                        {item.unit_price_centavos === null
                          ? "—"
                          : `${item.price_is_estimate ? "~" : ""}${formatMoney(item.unit_price_centavos * item.quantity, currency)}`}
                      </span>
                      {canEdit(item.added_by) && !editing && confirmId !== item.id && (
                        <Button
                          variant="ghost"
                          className="min-h-9 px-2 text-sm"
                          onClick={() => {
                            setConfirmId(null);
                            setEditingId(item.id);
                          }}
                        >
                          {item.is_shared ? "Edit sharing" : "Share"}
                        </Button>
                      )}
                      {canEdit(item.added_by) &&
                        !editing &&
                        (confirmId === item.id ? (
                          <div className="flex flex-col items-end gap-1">
                            {(billSent || item.added_by !== me.id) && (
                              <p className="max-w-48 text-right text-xs text-ink-soft">
                                {item.added_by !== me.id ? `${nameOf(data, item.added_by)} will be told in the app. ` : ""}
                                {billSent ? "The bill goes back to the host to send again." : ""}
                              </p>
                            )}
                            <div className="flex gap-1">
                              <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setConfirmId(null)}>
                                Keep
                              </Button>
                              <Button className="min-h-9 bg-danger px-2 text-sm active:bg-danger" onClick={() => remove(item.id)}>
                                {item.added_by === me.id ? "Remove" : `Remove ${nameOf(data, item.added_by)}'s`}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="danger" className="min-h-9 px-2 text-sm" onClick={() => remove(item.id)}>
                            Remove
                          </Button>
                        ))}
                    </div>
                    </div>
                    {editing && (
                      <ShareEditor
                        item={item}
                        data={data}
                        meId={me.id}
                        onDone={(saved) => {
                          setEditingId(null);
                          if (saved) void reload();
                        }}
                      />
                    )}
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
