/**
 * Pure menu helpers (no UI, no database). These mirror the checks in the
 * database function add_menu_item(), which is the one that actually decides
 * the price; the app uses these to show the live price and friendly errors.
 */
import type { Menu, MenuItem, MenuOption, OptionGroup, OrderOption } from "./types";

const bySort = <T extends { sort_order: number; name?: string }>(a: T, b: T) =>
  a.sort_order - b.sort_order || (a.name ?? "").localeCompare(b.name ?? "");

export interface ItemGroup {
  group: OptionGroup;
  options: MenuOption[];
}

/** Option groups (with their options) that apply to an item, in display order. */
export function groupsForItem(menu: Pick<Menu, "groups" | "options" | "links">, itemId: string): ItemGroup[] {
  const links = menu.links.filter((l) => l.menu_item_id === itemId).sort(bySort);
  return links
    .map((l) => menu.groups.find((g) => g.id === l.option_group_id))
    .filter((g): g is OptionGroup => Boolean(g))
    .map((group) => ({
      group,
      options: menu.options.filter((o) => o.option_group_id === group.id).sort(bySort),
    }));
}

/** Pre-selected options: each group's defaults (single-choice groups keep only the first default). */
export function defaultSelection(groups: ItemGroup[]): string[] {
  const ids: string[] = [];
  for (const { group, options } of groups) {
    const defaults = options.filter((o) => o.is_default);
    if (group.selection === "single") {
      if (defaults[0]) ids.push(defaults[0].id);
    } else {
      ids.push(...defaults.slice(0, group.max_select ?? defaults.length).map((o) => o.id));
    }
  }
  return ids;
}

/** Toggle an option, respecting single-choice groups (picking one replaces the other). */
export function toggleOption(groups: ItemGroup[], selected: string[], optionId: string): string[] {
  const owner = groups.find((g) => g.options.some((o) => o.id === optionId));
  if (!owner) return selected;
  if (selected.includes(optionId)) {
    return selected.filter((id) => id !== optionId);
  }
  if (owner.group.selection === "single") {
    const siblings = new Set(owner.options.map((o) => o.id));
    return [...selected.filter((id) => !siblings.has(id)), optionId];
  }
  const max = owner.group.max_select;
  const chosenInGroup = owner.options.filter((o) => selected.includes(o.id)).length;
  if (max !== null && chosenInGroup >= max) return selected; // full: ignore
  return [...selected, optionId];
}

/** Problems that stop the item being added, e.g. "Please choose size". Empty = OK. */
export function selectionProblems(groups: ItemGroup[], selected: string[]): string[] {
  const problems: string[] = [];
  for (const { group, options } of groups) {
    const chosen = options.filter((o) => selected.includes(o.id)).length;
    if (chosen < group.min_select) problems.push(`Please choose ${group.name.toLowerCase()}`);
    const max = group.selection === "single" ? 1 : group.max_select;
    if (max !== null && chosen > max) problems.push(`Too many choices for ${group.name.toLowerCase()}`);
  }
  return problems;
}

/** Unit price in centavos: base price plus the chosen options' price changes. */
export function unitPrice(item: Pick<MenuItem, "base_price_centavos">, groups: ItemGroup[], selected: string[]): number {
  let total = item.base_price_centavos;
  for (const { options } of groups) {
    for (const o of options) if (selected.includes(o.id)) total += o.price_delta_centavos;
  }
  return total;
}

/** Short text for chosen options, e.g. "Grande, Oat milk". */
export function optionsLabel(options: Pick<OrderOption, "option">[]): string {
  return options.map((o) => o.option).join(", ");
}

/** Public URL of a menu photo stored at `menu-photos/<path>` in Supabase Storage. */
export function photoUrl(supabaseUrl: string, path: string | null): string | null {
  if (!path) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/menu-photos/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
