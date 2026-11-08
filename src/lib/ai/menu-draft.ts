/**
 * The menu format Claude returns (structured output), and pure helpers that
 * turn it into an editable draft and then into the payload for the database
 * function apply_menu_import(). Prices travel as text ("180.50") and become
 * integer centavos here; floats never touch money.
 */
import { z } from "zod";
import { parseMoney } from "../money";

// ---------- What Claude returns ----------

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

/** JSON Schema sent as output_config.format (every object closed, every field required). */
export const AI_MENU_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["store_name", "branch", "currency", "categories", "option_groups", "warnings"],
  properties: {
    store_name: nullableString,
    branch: nullableString,
    currency: { type: "string", description: "ISO code, usually PHP" },
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "items"],
        properties: {
          name: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "description", "price", "option_groups"],
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                price: { ...nullableString, description: "Base price as digits, e.g. \"180\" or \"180.50\"; null if not shown" },
                option_groups: { type: "array", items: { type: "string" }, description: "Names of option_groups that apply" },
              },
            },
          },
        },
      },
    },
    option_groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "selection", "required", "max_choices", "options"],
        properties: {
          name: { type: "string" },
          selection: { type: "string", enum: ["single", "multi"] },
          required: { type: "boolean" },
          max_choices: { anyOf: [{ type: "integer" }, { type: "null" }] },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "price_change"],
              properties: {
                name: { type: "string" },
                price_change: { type: "string", description: "Added to the base price, e.g. \"20\", \"0\", \"-10\"" },
              },
            },
          },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

/** Same shape, validated in code (never trust parsed JSON blindly). */
export const AiMenuSchema = z.object({
  store_name: z.string().nullable(),
  branch: z.string().nullable(),
  currency: z.string(),
  categories: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          price: z.string().nullable(),
          option_groups: z.array(z.string()),
        }),
      ),
    }),
  ),
  option_groups: z.array(
    z.object({
      name: z.string(),
      selection: z.enum(["single", "multi"]),
      required: z.boolean(),
      max_choices: z.number().int().nullable(),
      options: z.array(z.object({ name: z.string(), price_change: z.string() })),
    }),
  ),
  warnings: z.array(z.string()),
});
export type AiMenu = z.infer<typeof AiMenuSchema>;

/** What an import job stores in `result`. */
export interface ImportResult {
  menu: AiMenu;
  sources: string[];
  warnings: string[];
}

// ---------- Editable draft (review screen) ----------

export interface DraftOption {
  name: string;
  price: string; // text box value, e.g. "20"
}
export interface DraftGroup {
  include: boolean;
  name: string;
  selection: "single" | "multi";
  required: boolean;
  maxChoices: number | null;
  options: DraftOption[];
}
export interface DraftItem {
  include: boolean;
  name: string;
  description: string;
  price: string; // "" when the menu didn't show one
  groups: string[];
  /** Same name already on the store's menu (left unticked by default). */
  duplicate: boolean;
}
export interface DraftCategory {
  include: boolean;
  name: string;
  items: DraftItem[];
}
export interface Draft {
  storeName: string;
  branch: string;
  sourceUrl: string;
  groups: DraftGroup[];
  categories: DraftCategory[];
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const key = (s: string) => clean(s).toLowerCase();

/** Money text as shown on a menu ("₱1,250", "180.00", "P95") -> "1250" / "180" / "95"; "" if unreadable. */
export function priceText(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = raw.replace(/^[Pp](?=\d)/, "").replace(/php/i, "");
  const c = parseMoney(cleaned);
  if (c === null) return "";
  const minor = Math.abs(c) % 100;
  return `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}${minor ? `.${String(minor).padStart(2, "0")}` : ""}`;
}

export function toDraft(
  result: ImportResult,
  opts: { existingItemNames?: string[]; storeName?: string; branch?: string } = {},
): Draft {
  const existing = new Set((opts.existingItemNames ?? []).map(key));
  const { menu } = result;
  const groups: DraftGroup[] = menu.option_groups
    .filter((g) => clean(g.name) && g.options.length)
    .map((g) => ({
      include: true,
      name: clean(g.name),
      selection: g.selection,
      required: g.required,
      maxChoices: g.selection === "multi" && g.max_choices && g.max_choices > 0 ? g.max_choices : null,
      options: g.options
        .filter((o) => clean(o.name))
        .map((o) => ({ name: clean(o.name), price: priceText(o.price_change) || "0" })),
    }));
  const groupNames = new Set(groups.map((g) => key(g.name)));

  const byName = new Map<string, DraftCategory>();
  for (const cat of menu.categories) {
    const name = clean(cat.name) || "Menu";
    const target = byName.get(key(name)) ?? { include: true, name, items: [] };
    byName.set(key(name), target);
    for (const it of cat.items) {
      if (!clean(it.name)) continue;
      const duplicate = existing.has(key(it.name));
      target.items.push({
        include: !duplicate,
        name: clean(it.name),
        description: clean(it.description),
        price: priceText(it.price),
        groups: it.option_groups.map(clean).filter((g) => groupNames.has(key(g))),
        duplicate,
      });
    }
  }

  return {
    storeName: clean(opts.storeName) || clean(menu.store_name),
    branch: clean(opts.branch) || clean(menu.branch),
    sourceUrl: result.sources.find((s) => /^https?:\/\//i.test(s)) ?? "",
    groups,
    categories: [...byName.values()].filter((c) => c.items.length),
  };
}

export interface ApplyPayload {
  store: { name: string; branch: string; source_url: string };
  option_groups: {
    name: string;
    selection: "single" | "multi";
    min_select: number;
    max_select: number | null;
    options: { name: string; price_delta_centavos: number }[];
  }[];
  categories: {
    name: string;
    items: { name: string; description: string; base_price_centavos: number; option_groups: string[] }[];
  }[];
}

/** Problems that block applying, e.g. an included item with no price. Empty = OK. */
export function draftProblems(d: Draft): string[] {
  const problems: string[] = [];
  for (const c of d.categories) {
    if (!c.include) continue;
    for (const i of c.items) {
      if (!i.include) continue;
      const p = parseMoney(i.price);
      if (!i.price.trim() || p === null || p < 0) problems.push(`Set a price for "${i.name}" (or untick it)`);
    }
  }
  for (const g of d.groups) {
    if (!g.include) continue;
    for (const o of g.options) {
      if (parseMoney(o.price || "0") === null) problems.push(`Fix the price change for "${o.name}" in ${g.name}`);
    }
  }
  if (!countIncluded(d)) problems.push("Tick at least one item");
  return problems;
}

export function countIncluded(d: Draft): number {
  return d.categories.filter((c) => c.include).reduce((n, c) => n + c.items.filter((i) => i.include).length, 0);
}

/** Only ticked groups/categories/items; prices converted to centavos. Call after draftProblems() is empty. */
export function toApplyPayload(d: Draft): ApplyPayload {
  const groups = d.groups.filter((g) => g.include && g.options.length);
  const kept = new Set(groups.map((g) => key(g.name)));
  return {
    store: { name: clean(d.storeName), branch: clean(d.branch), source_url: clean(d.sourceUrl) },
    option_groups: groups.map((g) => ({
      name: clean(g.name),
      selection: g.selection,
      min_select: g.required ? 1 : 0,
      max_select: g.selection === "multi" ? g.maxChoices : null,
      options: g.options.map((o) => ({ name: clean(o.name), price_delta_centavos: parseMoney(o.price || "0") ?? 0 })),
    })),
    categories: d.categories
      .filter((c) => c.include)
      .map((c) => ({
        name: clean(c.name),
        items: c.items
          .filter((i) => i.include)
          .map((i) => ({
            name: clean(i.name),
            description: clean(i.description),
            base_price_centavos: parseMoney(i.price) ?? 0,
            option_groups: i.groups.filter((g) => kept.has(key(g))),
          })),
      }))
      .filter((c) => c.items.length),
  };
}
