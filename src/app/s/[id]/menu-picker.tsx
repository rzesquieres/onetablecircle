"use client";

import { useMemo, useState } from "react";
import { Button, Chip, Input, Label, Notice } from "@/components/ui";
import { defaultSelection, groupsForItem, photoUrl, selectionProblems, toggleOption, unitPrice } from "@/lib/menu";
import { formatMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/supabase/env";
import type { Menu, MenuItem } from "@/lib/types";
import { ForWhom, QtyStepper, useForWhom } from "./for-whom";
import type { TabProps } from "./tab-props";

/** Browse the store's menu by category; tap an item to choose options and add it. */
export function MenuPicker({ data, me, reload, menu }: Pick<TabProps, "data" | "me" | "reload"> & { menu: Menu }) {
  const categories = useMemo(
    () =>
      [...menu.categories]
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .filter((c) => menu.items.some((i) => i.category_id === c.id)),
    [menu],
  );
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const [added, setAdded] = useState("");

  const activeCategory = categoryId ?? categories[0]?.id ?? null;
  const q = search.trim().toLowerCase();
  const items = menu.items
    .filter((i) => (q ? `${i.name} ${i.description}`.toLowerCase().includes(q) : i.category_id === activeCategory))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  if (menu.items.length === 0) {
    return <Notice>This store&apos;s menu is empty. Use &quot;Other item&quot; below.</Notice>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Input aria-label="Search the menu" placeholder="Search the menu…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {!q && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {categories.map((c) => (
            <Chip key={c.id} selected={c.id === activeCategory} onClick={() => setCategoryId(c.id)} className="shrink-0">
              {c.name}
            </Chip>
          ))}
        </div>
      )}
      {added && <Notice>{added} ✓</Notice>}
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const url = photoUrl(SUPABASE_URL, item.photo_path);
          const hasOptions = menu.links.some((l) => l.menu_item_id === item.id);
          return (
            <li key={item.id}>
              <button
                disabled={!item.is_available}
                onClick={() => {
                  setAdded("");
                  setOpenItem(item);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2 text-left active:bg-muted disabled:opacity-50"
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                  <img src={url} alt="" loading="lazy" className="size-16 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="size-16 shrink-0 rounded-xl bg-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-snug">{item.name}</span>
                  {item.description && <span className="line-clamp-2 text-sm text-ink-soft">{item.description}</span>}
                </span>
                <span className="shrink-0 pr-1 text-right text-sm">
                  {item.is_available ? (
                    <>
                      <span className="block font-semibold tabular-nums">
                        {item.price_status === "estimated" ? "~" : ""}
                        {formatMoney(item.base_price_centavos, menu.store.currency)}
                      </span>
                      {hasOptions && <span className="text-xs text-ink-soft">options</span>}
                    </>
                  ) : (
                    <span className="text-ink-soft">Sold out</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {items.length === 0 && <p className="text-ink-soft">No matches. Try &quot;Other item&quot; below.</p>}
      </ul>
      {menu.items.some((i) => i.price_status === "estimated") && (
        <p className="text-xs text-ink-soft">~ Estimated price: check the receipt.</p>
      )}

      {openItem && (
        <ItemSheet
          key={openItem.id}
          item={openItem}
          menu={menu}
          data={data}
          me={me}
          onClose={() => setOpenItem(null)}
          onAdded={(text) => {
            setOpenItem(null);
            setAdded(text);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function ItemSheet({
  item,
  menu,
  data,
  me,
  onClose,
  onAdded,
}: Pick<TabProps, "data" | "me"> & { item: MenuItem; menu: Menu; onClose: () => void; onAdded: (text: string) => void }) {
  const groups = useMemo(() => groupsForItem(menu, item.id), [menu, item.id]);
  const [selected, setSelected] = useState<string[]>(() => defaultSelection(groups));
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const who = useForWhom(data.participants, me.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);

  const problems = selectionProblems(groups, selected);
  const each = unitPrice(item, groups, selected);
  const currency = menu.store.currency;
  const url = photoUrl(SUPABASE_URL, item.photo_path);

  async function add() {
    setTried(true);
    if (problems.length) return;
    if (who.forIds.length === 0) return setError("Choose who this is for.");
    setBusy(true);
    setError("");
    const { error } = await getSupabase().rpc("add_menu_item", {
      p_session_id: data.session.id,
      p_menu_item_id: item.id,
      p_option_ids: selected,
      p_quantity: qty,
      p_notes: notes,
      p_is_shared: who.shared,
      p_assignee_ids: who.forIds,
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onAdded(`Added ${qty}× ${item.name}`);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" aria-hidden />
          {url && (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
            <img src={url} alt="" className="mb-3 aspect-[4/3] w-full rounded-2xl object-cover" />
          )}
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{item.name}</h2>
            <button onClick={onClose} className="min-h-11 px-2 text-ink-soft" aria-label="Close">✕</button>
          </div>
          {item.description && <p className="text-ink-soft">{item.description}</p>}
          {item.price_status === "estimated" && (
            <p className="mt-1 text-xs text-warn">Price is an estimate; the receipt decides.</p>
          )}

          <div className="mt-4 flex flex-col gap-5">
            {groups.map(({ group, options }) => {
              const chosen = options.filter((o) => selected.includes(o.id)).length;
              const missing = tried && chosen < group.min_select;
              const hint =
                group.selection === "single"
                  ? group.min_select > 0 ? "Choose 1" : "Optional"
                  : group.max_select ? `Up to ${group.max_select}` : "Choose any";
              return (
                <fieldset key={group.id}>
                  <legend className="mb-2 flex w-full items-center justify-between">
                    <span className="font-semibold">{group.name}</span>
                    <span className={`text-xs ${missing ? "font-semibold text-danger" : "text-ink-soft"}`}>
                      {missing ? "Required" : hint}
                    </span>
                  </legend>
                  <div className="flex flex-col">
                    {options.map((o) => (
                      <label key={o.id} className="flex min-h-12 items-center gap-3 border-b border-line last:border-0">
                        <input
                          type={group.selection === "single" ? "radio" : "checkbox"}
                          name={group.id}
                          className="size-5 accent-brand"
                          checked={selected.includes(o.id)}
                          onChange={() => setSelected((s) => toggleOption(groups, s, o.id))}
                          onClick={() => {
                            // Let people untick an optional single-choice option.
                            if (group.selection === "single" && group.min_select === 0 && selected.includes(o.id)) {
                              setSelected((s) => s.filter((id) => id !== o.id));
                            }
                          }}
                        />
                        <span className="flex-1">{o.name}</span>
                        {o.price_delta_centavos !== 0 && (
                          <span className="text-sm tabular-nums text-ink-soft">
                            {o.price_delta_centavos > 0 ? "+" : "−"}
                            {formatMoney(Math.abs(o.price_delta_centavos), currency)}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}

            <div>
              <Label htmlFor="sheet-notes">Notes (optional)</Label>
              <Input id="sheet-notes" maxLength={200} placeholder="e.g. less ice" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <ForWhom state={who} people={data.participants} meId={me.id} />
          </div>
        </div>

        <div className="border-t border-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {tried && problems.length > 0 && <p className="mb-2 text-sm text-danger">{problems[0]}</p>}
          {error && <div className="mb-2"><Notice tone="error">{error}</Notice></div>}
          <div className="flex items-center gap-3">
            <QtyStepper value={qty} onChange={setQty} />
            <Button className="min-h-14 flex-1 text-lg" disabled={busy} onClick={add}>
              {busy ? "Adding…" : `Add · ${item.price_status === "estimated" ? "~" : ""}${formatMoney(each * qty, currency)}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
