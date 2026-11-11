"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [preset, setPreset] = useState<Favorite | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [added, setAdded] = useState("");
  const storeId = menu.store.id;

  const loadFavorites = useCallback(async () => {
    const { data: rows } = await getSupabase()
      .from("favorites")
      .select("id, menu_item_id, option_ids, notes")
      .eq("store_id", storeId)
      .order("created_at");
    setFavorites((rows as Favorite[]) ?? []);
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .from("favorites")
      .select("id, menu_item_id, option_ids, notes")
      .eq("store_id", storeId)
      .order("created_at")
      .then(({ data: rows }) => {
        if (!cancelled) setFavorites((rows as Favorite[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

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
      <Usuals
        menu={menu}
        favorites={favorites}
        onPick={(item, fav) => {
          setAdded("");
          setPreset(fav);
          setOpenItem(item);
        }}
      />
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
          key={`${openItem.id}:${preset?.id ?? ""}`}
          item={openItem}
          menu={menu}
          data={data}
          me={me}
          preset={preset}
          onFavoritesChanged={loadFavorites}
          onClose={() => {
            setOpenItem(null);
            setPreset(null);
          }}
          onAdded={(text) => {
            setOpenItem(null);
            setPreset(null);
            setAdded(text);
            void reload();
          }}
        />
      )}
    </div>
  );
}

interface Favorite {
  id: string;
  menu_item_id: string;
  option_ids: string[];
  notes: string;
}

/** "Your usuals" at this store: tap to open the item with your usual options. */
function Usuals({
  menu,
  favorites,
  onPick,
}: {
  menu: Menu;
  favorites: Favorite[];
  onPick: (item: MenuItem, fav: Favorite) => void;
}) {
  const usable = favorites
    .map((f) => ({ f, item: menu.items.find((i) => i.id === f.menu_item_id) }))
    .filter((x): x is { f: Favorite; item: MenuItem } => Boolean(x.item?.is_available));
  if (!usable.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">★ Your usuals</p>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {usable.map(({ f, item }) => {
          const opts = menu.options.filter((o) => f.option_ids.includes(o.id)).map((o) => o.name);
          return (
            <button
              key={f.id}
              onClick={() => onPick(item, f)}
              className="flex min-h-12 shrink-0 flex-col justify-center rounded-2xl border border-brand/40 bg-surface px-3 py-1 text-left active:bg-muted"
            >
              <span className="text-sm font-medium">{item.name}</span>
              {(opts.length > 0 || f.notes) && (
                <span className="max-w-48 truncate text-xs text-ink-soft">{[...opts, f.notes].filter(Boolean).join(", ")}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ItemSheet({
  item,
  menu,
  data,
  me,
  preset,
  onFavoritesChanged,
  onClose,
  onAdded,
}: Pick<TabProps, "data" | "me"> & {
  item: MenuItem;
  menu: Menu;
  preset: Favorite | null;
  onFavoritesChanged: () => void;
  onClose: () => void;
  onAdded: (text: string) => void;
}) {
  const groups = useMemo(() => groupsForItem(menu, item.id), [menu, item.id]);
  const [selected, setSelected] = useState<string[]>(() => {
    if (!preset) return defaultSelection(groups);
    // Keep only options that still exist on this item.
    const valid = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
    return preset.option_ids.filter((id) => valid.has(id));
  });
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState(preset?.notes ?? "");
  const [favState, setFavState] = useState<"idle" | "saving" | "saved">(preset ? "saved" : "idle");
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
            <ForWhom state={who} people={data.participants} meId={me.id} sessionId={data.session.id} />
            <div className="flex flex-wrap items-center gap-x-4">
              {preset ? (
                <button
                  type="button"
                  className="min-h-11 text-sm text-ink-soft underline"
                  onClick={async () => {
                    await getSupabase().from("favorites").delete().eq("id", preset.id);
                    onFavoritesChanged();
                    onClose();
                  }}
                >
                  Remove from my usuals
                </button>
              ) : (
                <button
                  type="button"
                  disabled={favState !== "idle" || problems.length > 0}
                  className="min-h-11 text-sm font-medium text-brand disabled:text-ink-soft"
                  onClick={async () => {
                    setFavState("saving");
                    const { error } = await getSupabase()
                      .from("favorites")
                      .insert({ store_id: menu.store.id, menu_item_id: item.id, option_ids: [...selected].sort(), notes: notes.trim() });
                    // A duplicate means it's already a usual, which is fine.
                    setFavState(error && !/duplicate/i.test(error.message) ? "idle" : "saved");
                    if (error && !/duplicate/i.test(error.message)) setError(friendlyError(error));
                    else onFavoritesChanged();
                  }}
                >
                  {favState === "saved" ? "★ Saved as my usual" : "☆ Save as my usual"}
                </button>
              )}
            </div>
            <ReportProblem storeId={menu.store.id} itemId={item.id} />
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

const REPORT_KINDS = [
  { kind: "wrong_price", label: "Wrong price" },
  { kind: "wrong_item", label: "Wrong name or details" },
  { kind: "unavailable", label: "No longer sold" },
  { kind: "other", label: "Something else" },
] as const;

/** Lets anyone at the table flag a menu item that looks wrong; admins see it in Admin -> Problem reports. */
function ReportProblem({ storeId, itemId }: { storeId: string; itemId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof REPORT_KINDS)[number]["kind"]>("wrong_price");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function send() {
    setState("sending");
    setError("");
    const { error } = await getSupabase()
      .from("menu_reports")
      .insert({ store_id: storeId, menu_item_id: itemId, kind, note: note.trim() });
    if (error) {
      setError(friendlyError(error));
      setState("idle");
      return;
    }
    setState("sent");
  }

  if (state === "sent") return <p className="text-sm text-ink-soft">Thanks! We&apos;ll check this item.</p>;
  if (!open) {
    return (
      <button type="button" className="min-h-11 self-start text-sm text-ink-soft underline" onClick={() => setOpen(true)}>
        Report a problem with this item
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line p-3">
      <p className="text-sm font-medium">What&apos;s wrong?</p>
      <div className="flex flex-wrap gap-2">
        {REPORT_KINDS.map((k) => (
          <Chip key={k.kind} selected={kind === k.kind} onClick={() => setKind(k.kind)}>
            {k.label}
          </Chip>
        ))}
      </div>
      <Input maxLength={500} placeholder="Details (e.g. menu now says ₱195)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="min-h-11 text-sm" disabled={state === "sending"} onClick={send}>
          {state === "sending" ? "Sending…" : "Send report"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 text-sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}