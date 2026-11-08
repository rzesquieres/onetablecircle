"use client";

import { useState, type FormEvent } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, Card, Input, Label } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getSupabase } from "@/lib/supabase/client";
import type { MenuOption, OptionGroup } from "@/lib/types";
import { pesoInput, pesoText, type EditorProps } from "./editor-context";

/**
 * Option groups are shared across the store's menu: define "Size" or "Milk"
 * once, then tick it on every item it applies to.
 */
export function OptionGroupsEditor(props: EditorProps) {
  const { menu, act } = props;
  const [name, setName] = useState("");
  const [selection, setSelection] = useState<"single" | "multi">("single");

  async function addGroup(e: FormEvent) {
    e.preventDefault();
    const ok = await act(
      getSupabase().from("option_groups").insert({
        store_id: menu.store.id,
        name: name.trim(),
        selection,
        min_select: selection === "single" ? 1 : 0,
        sort_order: menu.groups.length,
      }),
    );
    if (ok) setName("");
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Options (size, milk, sugar, add-ons…)</h2>
        <p className="text-sm text-ink-soft">
          Create each group once, then tick it on the items it applies to (in the item editor above).
        </p>
      </div>
      {menu.groups.map((g) => (
        <GroupCard key={g.id} {...props} group={g} options={menu.options.filter((o) => o.option_group_id === g.id)} />
      ))}
      <Card>
        <form onSubmit={addGroup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="gname">New option group</Label>
            <Input id="gname" required maxLength={60} placeholder="e.g. Size" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="gsel">Customers pick</Label>
            <select
              id="gsel"
              className="min-h-12 w-full rounded-xl border border-line bg-surface px-3"
              value={selection}
              onChange={(e) => setSelection(e.target.value as "single" | "multi")}
            >
              <option value="single">One (e.g. size)</option>
              <option value="multi">Several (e.g. add-ons)</option>
            </select>
          </div>
          <Button type="submit">Add group</Button>
        </form>
      </Card>
    </section>
  );
}

function GroupCard({ menu, act, group, options }: EditorProps & { group: OptionGroup; options: MenuOption[] }) {
  const [name, setName] = useState(group.name);
  const [selection, setSelection] = useState(group.selection);
  const [required, setRequired] = useState(group.min_select > 0);
  const [max, setMax] = useState(group.max_select ? String(group.max_select) : "");
  const usedBy = menu.links.filter((l) => l.option_group_id === group.id).length;

  const dirty =
    name !== group.name ||
    selection !== group.selection ||
    required !== group.min_select > 0 ||
    max !== (group.max_select ? String(group.max_select) : "");

  async function save() {
    const maxNum = selection === "multi" && max.trim() ? Math.max(1, Math.floor(Number(max))) : null;
    await act(
      getSupabase()
        .from("option_groups")
        .update({
          name: name.trim(),
          selection,
          min_select: required ? 1 : 0,
          max_select: selection === "single" ? null : maxNum,
        })
        .eq("id", group.id),
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <Label>Group name</Label>
          <Input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Customers pick</Label>
          <select
            className="min-h-12 w-full rounded-xl border border-line bg-surface px-3"
            value={selection}
            onChange={(e) => setSelection(e.target.value as "single" | "multi")}
          >
            <option value="single">One</option>
            <option value="multi">Several</option>
          </select>
        </div>
        {selection === "multi" && (
          <div>
            <Label>Max (blank = no limit)</Label>
            <Input inputMode="numeric" className="sm:w-28" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} />
          </div>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-brand" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Required (customer must choose{selection === "single" ? " one" : " at least one"})
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {dirty && <Button onClick={save}>Save group</Button>}
        <span className="text-sm text-ink-soft">Used by {usedBy} item{usedBy === 1 ? "" : "s"}</span>
        <span className="flex-1" />
        <ConfirmButton
          small
          label="Delete group"
          question={`Delete "${group.name}" and its options?`}
          confirmLabel="Delete"
          onConfirm={() => act(getSupabase().from("option_groups").delete().eq("id", group.id)).then(() => undefined)}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="text-sm font-medium">Choices</p>
        {options.map((o) => (
          <OptionRow key={o.id} act={act} option={o} single={group.selection === "single"} />
        ))}
        <NewOptionRow act={act} group={group} count={options.length} />
      </div>
    </Card>
  );
}

function OptionRow({ act, option, single }: Pick<EditorProps, "act"> & { option: MenuOption; single: boolean }) {
  const [name, setName] = useState(option.name);
  const [price, setPrice] = useState(pesoText(option.price_delta_centavos));
  const [isDefault, setIsDefault] = useState(option.is_default);
  const [bad, setBad] = useState(false);
  const dirty = name !== option.name || price !== pesoText(option.price_delta_centavos) || isDefault !== option.is_default;

  async function save() {
    const delta = pesoInput(price);
    if (delta === null) return setBad(true);
    setBad(false);
    await act(
      getSupabase()
        .from("options")
        .update({ name: name.trim(), price_delta_centavos: delta, is_default: isDefault })
        .eq("id", option.id),
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="min-w-40 flex-1" maxLength={60} aria-label="Choice name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-center gap-1">
        <span className="text-sm text-ink-soft">+₱</span>
        <Input
          className={`w-24 ${bad ? "border-danger" : ""}`}
          inputMode="decimal"
          aria-label="Price change"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      <label className="flex min-h-11 items-center gap-1 text-sm">
        <input type="checkbox" className="size-5 accent-brand" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        {single ? "Pre-selected" : "Pre-ticked"}
      </label>
      {dirty && <Button className="min-h-9 px-3 text-sm" onClick={save}>Save</Button>}
      <ConfirmButton
        small
        label="✕"
        confirmLabel="Delete"
        onConfirm={() => act(getSupabase().from("options").delete().eq("id", option.id)).then(() => undefined)}
      />
    </div>
  );
}

function NewOptionRow({ act, group, count }: Pick<EditorProps, "act"> & { group: OptionGroup; count: number }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [bad, setBad] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    const delta = pesoInput(price);
    if (delta === null) return setBad(true);
    setBad(false);
    const ok = await act(
      getSupabase().from("options").insert({
        store_id: group.store_id,
        option_group_id: group.id,
        name: name.trim(),
        price_delta_centavos: delta,
        sort_order: count,
      }),
    );
    if (ok) {
      setName("");
      setPrice("");
    }
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-center gap-2">
      <Input className="min-w-40 flex-1" required maxLength={60} placeholder="New choice, e.g. Grande" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-center gap-1">
        <span className="text-sm text-ink-soft">+₱</span>
        <Input className={`w-24 ${bad ? "border-danger" : ""}`} inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm">Add</Button>
      {bad && <span className="text-sm text-danger">Price like 20 or 20.50 ({formatMoney(2050)})</span>}
    </form>
  );
}
