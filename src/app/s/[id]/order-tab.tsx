"use client";

import { useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { optionsText } from "@/lib/consolidate";
import { formatMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { isActive } from "@/lib/session-rules";
import { FreeTextForm } from "./free-text-form";
import { MenuPicker } from "./menu-picker";
import { nameOf, type TabProps } from "./tab-props";

export function OrderTab(props: TabProps) {
  const { data, me, isHost, ordersOpen, reload, menu } = props;
  const [showOther, setShowOther] = useState(false);
  const [error, setError] = useState("");
  // Two taps to remove: the first arms the button, the second deletes.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const currency = data.session.currency;
  const hasStore = Boolean(data.session.store_id);

  async function remove(itemId: string) {
    if (confirmId !== itemId) return setConfirmId(itemId);
    setConfirmId(null);
    setError("");
    const { data: deleted, error } = await getSupabase().from("order_items").delete().eq("id", itemId).select("id");
    if (error) setError(friendlyError(error));
    else if (!deleted?.length) setError("Couldn't remove that item. Ordering may have closed.");
    void reload();
  }

  const canEdit = (addedBy: string) => (addedBy === me.id && ordersOpen) || (isHost && isActive(data.session));
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
              const forPids = data.assignees.filter((a) => a.order_item_id === item.id).map((a) => a.participant_id);
              const forNames = forPids.map((pid) => (pid === me.id ? "you" : nameOf(data, pid)));
              const showAddedBy = item.is_shared || forPids[0] !== item.added_by;
              const opts = optionsText(item);
              return (
                <li key={item.id}>
                  <Card className="flex items-start justify-between gap-3 py-3">
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
                      {canEdit(item.added_by) &&
                        (confirmId === item.id ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setConfirmId(null)}>
                              Keep
                            </Button>
                            <Button className="min-h-9 bg-danger px-2 text-sm active:bg-danger" onClick={() => remove(item.id)}>
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
