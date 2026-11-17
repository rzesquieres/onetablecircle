/**
 * Pure helpers for importing a menu into a new or existing store (OTC-28):
 * suggesting an existing store with a similar name, and previewing what a
 * merge will do. The matching rule mirrors the database function
 * apply_menu_import_v2(), which is what actually applies the import.
 */
import { parseMoney } from "../money";
import type { Draft } from "./menu-draft";

/** Same rule as public.menu_name_key(): trimmed, spaces collapsed, lower case. */
export function nameKey(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Looser key for comparing store names: no accents, punctuation or "the". */
function storeKey(s: string | null | undefined): string {
  return nameKey(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim();
}

export interface StoreChoice {
  id: string;
  name: string;
  branch: string;
  status?: string;
}

export function storeLabel(s: { name: string; branch: string }): string {
  return s.branch ? `${s.name} · ${s.branch}` : s.name;
}

/**
 * Existing stores that look like the one being imported, best first.
 * Same name (ignoring case, accents, punctuation) ranks highest, then names
 * that contain each other, then names sharing most of their words. A
 * matching branch breaks ties.
 */
export function suggestStores(name: string, branch: string, stores: StoreChoice[], limit = 3): StoreChoice[] {
  const k = storeKey(name);
  if (!k) return [];
  const words = new Set(k.split(" "));
  const b = storeKey(branch);
  const scored: { s: StoreChoice; score: number }[] = [];
  for (const s of stores) {
    const sk = storeKey(s.name);
    if (!sk) continue;
    let score = 0;
    if (sk === k) score = 30;
    else if (sk.includes(k) || k.includes(sk)) score = 20;
    else {
      const other = new Set(sk.split(" "));
      const shared = [...words].filter((w) => other.has(w)).length;
      const ratio = shared / Math.max(words.size, other.size);
      if (ratio >= 0.5) score = 10 * ratio;
    }
    if (!score) continue;
    if (b && storeKey(s.branch) === b) score += 5;
    scored.push({ s, score });
  }
  return scored.sort((x, y) => y.score - x.score || x.s.name.localeCompare(y.s.name)).slice(0, limit).map((x) => x.s);
}

/** Search box filter for the "update an existing restaurant" list. */
export function filterStores(query: string, stores: StoreChoice[], limit = 8): StoreChoice[] {
  const q = storeKey(query);
  const list = q
    ? stores.filter((s) => storeKey(`${s.name} ${s.branch}`).includes(q))
    : stores;
  return [...list].sort((a, b) => storeLabel(a).localeCompare(storeLabel(b))).slice(0, limit);
}

export interface ExistingItem {
  id: string;
  name: string;
  categoryName: string;
  base_price_centavos: number;
  is_available: boolean;
}

export type ItemPlan =
  | { kind: "new" }
  | { kind: "update"; existing: ExistingItem; priceChanged: boolean; moved: boolean };

export interface MergePlan {
  /** plans[ci][ii] for every draft item; null when the item or its category is unticked. */
  plans: (ItemPlan | null)[][];
  added: number;
  updated: number;
  /** Replace mode only: available items not in the upload, which will be hidden. */
  hidden: ExistingItem[];
}

/**
 * What applying the ticked items will do to a store's existing items.
 * Items are matched by name; one in the same category wins over one
 * elsewhere, and each existing item is matched at most once.
 */
export function planMerge(draft: Draft, existing: ExistingItem[], mode: "merge" | "replace"): MergePlan {
  const used = new Set<string>();
  let added = 0;
  let updated = 0;
  const plans = draft.categories.map((c) =>
    c.items.map((item): ItemPlan | null => {
      if (!c.include || !item.include) return null;
      const k = nameKey(item.name);
      const candidates = existing.filter((e) => !used.has(e.id) && nameKey(e.name) === k);
      const match =
        candidates.find((e) => nameKey(e.categoryName) === nameKey(c.name)) ?? candidates[0];
      if (!match) {
        added++;
        return { kind: "new" };
      }
      used.add(match.id);
      updated++;
      const price = parseMoney(item.price);
      return {
        kind: "update",
        existing: match,
        priceChanged: price !== null && price !== match.base_price_centavos,
        moved: nameKey(match.categoryName) !== nameKey(c.name),
      };
    }),
  );
  const hidden = mode === "replace" ? existing.filter((e) => e.is_available && !used.has(e.id)) : [];
  return { plans, added, updated, hidden };
}

/** Summary saved by apply_menu_import_v2() on the job (result.applied_summary). */
export interface AppliedSummary {
  store_id: string;
  created_store: boolean;
  mode: "new" | "merge" | "replace";
  added: number;
  updated: number;
  hidden: number;
}

export function summaryText(s: AppliedSummary): string {
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  if (s.created_store) return `Created a new restaurant with ${n(s.added, "item")}.`;
  const parts = [`${n(s.updated, "item")} updated`, `${n(s.added, "item")} added`];
  if (s.mode === "replace") parts.push(`${n(s.hidden, "item")} hidden`);
  return `${parts.join(", ")}.`;
}
