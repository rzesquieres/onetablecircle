"use client";

import { useState, type FormEvent } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, Card, Input, Label, Notice } from "@/components/ui";
import { photoUrl } from "@/lib/menu";
import { formatMoney } from "@/lib/money";
import { deleteMenuPhoto, uploadMenuPhoto } from "@/lib/photos";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/supabase/env";
import type { MenuCategory, MenuItem } from "@/lib/types";
import { pesoInput, pesoText, type EditorProps } from "./editor-context";

export function MenuSectionsEditor(props: EditorProps) {
  const { menu, act } = props;
  const [name, setName] = useState("");
  const categories = [...menu.categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    const ok = await act(
      getSupabase().from("menu_categories").insert({ store_id: menu.store.id, name: name.trim(), sort_order: categories.length }),
    );
    if (ok) setName("");
  }

  /** Swap a category with its neighbour by renumbering everything in the new order. */
  async function move(index: number, dir: -1 | 1) {
    const order = [...categories];
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    const supabase = getSupabase();
    await act(
      Promise.all(
        order.map((c, i) => supabase.from("menu_categories").update({ sort_order: i }).eq("id", c.id)),
      ).then((results) => ({ error: results.find((r) => r.error)?.error ?? null })),
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Menu</h2>
      {categories.length === 0 && <p className="text-ink-soft">Start by adding a category, e.g. &quot;Coffee&quot; or &quot;Pasta&quot;.</p>}
      {categories.map((c, i) => (
        <CategoryCard
          key={c.id}
          {...props}
          category={c}
          first={i === 0}
          last={i === categories.length - 1}
          onMove={(dir) => move(i, dir)}
        />
      ))}
      <Card>
        <form onSubmit={addCategory} className="flex gap-2">
          <Input required maxLength={60} placeholder="New category, e.g. Coffee" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">Add</Button>
        </form>
      </Card>
    </section>
  );
}

function CategoryCard({
  menu,
  act,
  reload,
  category,
  first,
  last,
  onMove,
}: EditorProps & { category: MenuCategory; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const [name, setName] = useState(category.name);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = menu.items
    .filter((i) => i.category_id === category.id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-40 flex-1 font-semibold" maxLength={60} aria-label="Category name" value={name} onChange={(e) => setName(e.target.value)} />
        {name !== category.name && (
          <Button className="min-h-11 px-3 text-sm" onClick={() => act(getSupabase().from("menu_categories").update({ name: name.trim() }).eq("id", category.id))}>
            Save
          </Button>
        )}
        <Button variant="ghost" className="min-h-11 px-3" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>↑</Button>
        <Button variant="ghost" className="min-h-11 px-3" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>↓</Button>
        <ConfirmButton
          small
          label="Delete"
          question={items.length ? `Delete with its ${items.length} items?` : undefined}
          confirmLabel="Delete"
          onConfirm={async () => {
            const ok = await act(getSupabase().from("menu_categories").delete().eq("id", category.id));
            if (ok) await Promise.all(items.map((i) => deleteMenuPhoto(i.photo_path)));
          }}
        />
      </div>

      <ul className="flex flex-col divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="py-2">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpenId(openId === item.id ? null : item.id)}>
              <Thumb path={item.photo_path} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="text-sm text-ink-soft">
                  {formatMoney(item.base_price_centavos)}
                  {item.price_status === "estimated" && " · estimated"}
                  {!item.is_available && " · sold out"}
                  {menu.links.some((l) => l.menu_item_id === item.id) &&
                    ` · ${menu.links.filter((l) => l.menu_item_id === item.id).length} option group(s)`}
                </span>
              </span>
              <span className="text-sm text-brand">{openId === item.id ? "Close" : "Edit"}</span>
            </button>
            {openId === item.id && (
              <ItemEditor menu={menu} act={act} reload={reload} item={item} onDone={() => setOpenId(null)} />
            )}
          </li>
        ))}
      </ul>
      <NewItemForm act={act} storeId={menu.store.id} categoryId={category.id} count={items.length} />
    </Card>
  );
}

function Thumb({ path }: { path: string | null }) {
  const url = photoUrl(SUPABASE_URL, path);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL; no image optimiser on Hostinger
    <img src={url} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-ink-soft">No photo</span>
  );
}

function NewItemForm({ act, storeId, categoryId, count }: Pick<EditorProps, "act"> & { storeId: string; categoryId: string; count: number }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [bad, setBad] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    const cents = pesoInput(price);
    if (cents === null || cents < 0 || !price.trim()) return setBad(true);
    setBad(false);
    const ok = await act(
      getSupabase().from("menu_items").insert({
        store_id: storeId,
        category_id: categoryId,
        name: name.trim(),
        base_price_centavos: cents,
        sort_order: count,
      }),
    );
    if (ok) {
      setName("");
      setPrice("");
    }
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <Input className="min-w-40 flex-1" required maxLength={120} placeholder="New item, e.g. Iced latte" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-center gap-1">
        <span className="text-sm text-ink-soft">₱</span>
        <Input className={`w-28 ${bad ? "border-danger" : ""}`} required inputMode="decimal" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <Button type="submit" variant="secondary">Add item</Button>
    </form>
  );
}

function ItemEditor({ menu, act, reload, item, onDone }: EditorProps & { item: MenuItem; onDone: () => void }) {
  const linked = menu.links.filter((l) => l.menu_item_id === item.id).map((l) => l.option_group_id);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [price, setPrice] = useState(pesoText(item.base_price_centavos));
  const [estimated, setEstimated] = useState(item.price_status === "estimated");
  const [available, setAvailable] = useState(item.is_available);
  const [categoryId, setCategoryId] = useState(item.category_id);
  const [groups, setGroups] = useState<string[]>(linked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    const cents = pesoInput(price);
    if (cents === null || cents < 0) return setError("Price should look like 180 or 180.50.");
    setBusy(true);
    setError("");
    const supabase = getSupabase();
    const removed = linked.filter((g) => !groups.includes(g));
    const added = groups.filter((g) => !linked.includes(g));
    const results = await Promise.all([
      supabase
        .from("menu_items")
        .update({
          name: name.trim(),
          description: description.trim(),
          base_price_centavos: cents,
          price_status: estimated ? "estimated" : "confirmed",
          is_available: available,
          category_id: categoryId,
        })
        .eq("id", item.id),
      removed.length
        ? supabase.from("menu_item_option_groups").delete().eq("menu_item_id", item.id).in("option_group_id", removed)
        : Promise.resolve({ error: null }),
      added.length
        ? supabase.from("menu_item_option_groups").insert(
            added.map((g) => ({
              menu_item_id: item.id,
              option_group_id: g,
              store_id: item.store_id,
              sort_order: menu.groups.find((x) => x.id === g)?.sort_order ?? 0,
            })),
          )
        : Promise.resolve({ error: null }),
    ]);
    const err = results.find((r) => r.error)?.error;
    setBusy(false);
    if (err) return setError(friendlyError(err));
    await reload();
    onDone();
  }

  async function changePhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const path = await uploadMenuPhoto(item.store_id, item.id, file);
      const ok = await act(getSupabase().from("menu_items").update({ photo_path: path }).eq("id", item.id));
      if (ok) await deleteMenuPhoto(item.photo_path);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    const ok = await act(getSupabase().from("menu_items").update({ photo_path: null }).eq("id", item.id));
    if (ok) await deleteMenuPhoto(item.photo_path);
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-col gap-3 rounded-xl bg-muted p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Price (₱, before options)</Label>
          <Input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Description (optional)</Label>
        <textarea
          className="min-h-20 w-full rounded-xl border border-line bg-surface px-3 py-2 text-base"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-x-5">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-brand" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
          Available (untick = sold out)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-brand" checked={estimated} onChange={(e) => setEstimated(e.target.checked)} />
          Price is an estimate (not confirmed)
        </label>
      </div>
      {menu.categories.length > 1 && (
        <div>
          <Label>Category</Label>
          <select className="min-h-12 w-full rounded-xl border border-line bg-surface px-3" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {menu.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label>Options for this item</Label>
        {menu.groups.length === 0 ? (
          <p className="text-sm text-ink-soft">No option groups yet. Add them in &quot;Options&quot; below.</p>
        ) : (
          <div className="flex flex-wrap gap-x-5">
            {menu.groups.map((g) => (
              <label key={g.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-brand"
                  checked={groups.includes(g.id)}
                  onChange={(e) => setGroups(e.target.checked ? [...groups, g.id] : groups.filter((x) => x !== g.id))}
                />
                {g.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Thumb path={item.photo_path} />
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-surface px-3 text-sm font-medium">
          {item.photo_path ? "Change photo" : "Add photo"}
          <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => changePhoto(e.target.files?.[0])} />
        </label>
        {item.photo_path && (
          <Button type="button" variant="ghost" className="min-h-11 text-sm" onClick={removePhoto} disabled={busy}>
            Remove photo
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save item"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <span className="flex-1" />
        <ConfirmButton
          small
          label="Delete item"
          confirmLabel="Delete"
          onConfirm={async () => {
            const ok = await act(getSupabase().from("menu_items").delete().eq("id", item.id));
            if (ok) await deleteMenuPhoto(item.photo_path);
          }}
        />
      </div>
    </form>
  );
}
