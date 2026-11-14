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

/** Public URL of a file in a public Supabase Storage bucket. */
export function publicStorageUrl(supabaseUrl: string, bucket: string, path: string | null): string | null {
  if (!path) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Public URL of a menu photo stored at `menu-photos/<path>`. */
export function photoUrl(supabaseUrl: string, path: string | null): string | null {
  return publicStorageUrl(supabaseUrl, "menu-photos", path);
}

/**
 * Diner-friendly category order (OTC-24). Diners look for what's popular
 * first, then work through a meal: starters, mains, sharing platters, sides,
 * drinks, dessert. Categories are matched to these groups by name; anything
 * unrecognised goes between sides and drinks.
 */
const DINER_GROUPS: { rank: number; words: RegExp }[] = [
  { rank: 0, words: /best ?sell|popular|recommend|featured|favou?rite|signature|special|must[- ]?try|top pick|chef|\bnew\b/ },
  { rank: 1, words: /starter|appeti[sz]er|small plate|pica|pulutan|snack|salad|soup|bites|finger food|tapas/ },
  { rank: 5, words: /\bsides?\b|add[- ]?ons?|\bextras?\b|\bsauces?\b|\bdips?\b|topping|condiment/ },
  { rank: 3, words: /platter|sharing|share|family|group|barkada|bundle|boodle|for \d|good for|party/ },
  { rank: 7, words: /drink|beverage|juice|coffee|\btea\b|shake|smoothie|soda|beer|wine|cocktail|liquor|refresher|frappe|latte|milk ?tea|lemonade|water/ },
  { rank: 8, words: /dessert|sweet|cake|ice cream|halo|pastr|pie\b|kakanin|leche|gelato|waffle|donut|doughnut/ },
  { rank: 2, words: /main|entr[eé]e|rice|meal|silog|pasta|noodle|pancit|grill|bbq|barbecue|chicken|pork|beef|seafood|fish|steak|burger|pizza|sandwich|wrap|bowl|ulam|vegetable|veggie|curry|ramen|sushi|dimsum|dim sum/ },
];
const OTHER_RANK = 6;

/** Where a category name falls in the diner-friendly order (lower = shown earlier). */
export function dinerCategoryRank(name: string): number {
  const n = name.toLowerCase();
  return DINER_GROUPS.find((g) => g.words.test(n))?.rank ?? OTHER_RANK;
}

/**
 * Categories in the order the menu shows them, without empty ones.
 * `custom` = the store's admin chose their own order (sort_order only);
 * otherwise diner-friendly groups come first and sort_order breaks ties.
 */
export function orderCategories<C extends { id: string; name: string; sort_order: number }>(
  categories: C[],
  items: { category_id: string }[],
  custom = false,
): C[] {
  const used = new Set(items.map((i) => i.category_id));
  return categories
    .filter((c) => used.has(c.id))
    .sort(
      (a, b) =>
        (custom ? 0 : dinerCategoryRank(a.name) - dinerCategoryRank(b.name)) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Menu items already ordered at this table, most-ordered first (ties: most
 * recently ordered first). Only items still on the menu and available.
 */
export function orderedAtTable<I extends { id: string; is_available: boolean }>(
  menuItems: I[],
  orders: { menu_item_id: string | null; quantity: number; created_at: string }[],
): I[] {
  const stats = new Map<string, { qty: number; last: string }>();
  for (const o of orders) {
    if (!o.menu_item_id) continue;
    const s = stats.get(o.menu_item_id) ?? { qty: 0, last: "" };
    s.qty += o.quantity;
    if (o.created_at > s.last) s.last = o.created_at;
    stats.set(o.menu_item_id, s);
  }
  return menuItems
    .filter((i) => i.is_available && stats.has(i.id))
    .sort((a, b) => {
      const sa = stats.get(a.id)!;
      const sb = stats.get(b.id)!;
      return sb.qty - sa.qty || sb.last.localeCompare(sa.last);
    });
}
