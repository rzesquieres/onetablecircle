import { describe, expect, it } from "vitest";
import type { Draft } from "./menu-draft";
import { filterStores, nameKey, planMerge, suggestStores, summaryText, type ExistingItem } from "./menu-merge";

const stores = [
  { id: "1", name: "Mary Grace Café", branch: "Makati" },
  { id: "2", name: "Mary Grace Cafe", branch: "BGC" },
  { id: "3", name: "Kape Ni Juan", branch: "" },
  { id: "4", name: "The Coffee Bean & Tea Leaf", branch: "" },
  { id: "5", name: "Jollibee", branch: "" },
];

describe("nameKey", () => {
  it("ignores case and extra spaces, like the database", () => {
    expect(nameKey("  Spanish   LATTE ")).toBe("spanish latte");
    expect(nameKey(null)).toBe("");
  });
});

describe("suggestStores", () => {
  it("ranks same name first, ignoring accents, and prefers the same branch", () => {
    expect(suggestStores("mary grace cafe", "BGC", stores).map((s) => s.id)).toEqual(["2", "1"]);
  });

  it("finds names that contain each other or share most words", () => {
    expect(suggestStores("Coffee Bean and Tea Leaf", "", stores).map((s) => s.id)).toEqual(["4"]);
    expect(suggestStores("Kape ni Juan Coffee", "", stores).map((s) => s.id)).toEqual(["3"]);
  });

  it("returns nothing for unrelated or empty names", () => {
    expect(suggestStores("Max's Restaurant", "", stores)).toEqual([]);
    expect(suggestStores("  ", "", stores)).toEqual([]);
  });
});

describe("filterStores", () => {
  it("searches name and branch", () => {
    expect(filterStores("makati", stores).map((s) => s.id)).toEqual(["1"]);
    expect(filterStores("", stores, 2)).toHaveLength(2);
  });
});

const draft: Draft = {
  storeName: "",
  branch: "",
  sourceUrl: "",
  groups: [],
  categories: [
    {
      include: true,
      name: "Coffee",
      items: [
        { include: true, name: "spanish latte", description: "", price: "175", groups: [] },
        { include: true, name: "Americano", description: "", price: "120", groups: [] },
        { include: true, name: "Mocha", description: "", price: "180", groups: [] },
        { include: false, name: "Ensaymada", description: "", price: "90", groups: [] },
      ],
    },
    {
      include: true,
      name: "Iced",
      items: [{ include: true, name: "Americano", description: "", price: "130", groups: [] }],
    },
  ],
};

const existing: ExistingItem[] = [
  { id: "a-iced", name: "Americano", categoryName: "Iced", base_price_centavos: 13000, is_available: true },
  { id: "a-hot", name: "Americano", categoryName: "coffee", base_price_centavos: 12000, is_available: true },
  { id: "latte", name: "Spanish Latte", categoryName: "Coffee", base_price_centavos: 16500, is_available: true },
  { id: "ens", name: "Ensaymada", categoryName: "Pastries", base_price_centavos: 9000, is_available: true },
  { id: "old", name: "Old item", categoryName: "Coffee", base_price_centavos: 100, is_available: false },
];

describe("planMerge", () => {
  it("updates same-named items, preferring the same category, and adds the rest", () => {
    const p = planMerge(draft, existing, "merge");
    expect(p.added).toBe(1);
    expect(p.updated).toBe(3);
    expect(p.hidden).toEqual([]);
    const [latte, hot, mocha, ens] = p.plans[0];
    expect(latte).toMatchObject({ kind: "update", priceChanged: true, moved: false, existing: { id: "latte" } });
    expect(hot).toMatchObject({ kind: "update", priceChanged: false, existing: { id: "a-hot" } });
    expect(mocha).toEqual({ kind: "new" });
    expect(ens).toBeNull();
    expect(p.plans[1][0]).toMatchObject({ kind: "update", existing: { id: "a-iced" } });
  });

  it("replace lists available items that are not in the upload", () => {
    expect(planMerge(draft, existing, "replace").hidden.map((e) => e.id)).toEqual(["ens"]);
  });
});

describe("summaryText", () => {
  it("reads naturally", () => {
    const base = { store_id: "s", hidden: 0 };
    expect(summaryText({ ...base, created_store: true, mode: "new", added: 12, updated: 0 })).toBe(
      "Created a new restaurant with 12 items.",
    );
    expect(summaryText({ ...base, created_store: false, mode: "merge", added: 1, updated: 3 })).toBe(
      "3 items updated, 1 item added.",
    );
    expect(summaryText({ ...base, created_store: false, mode: "replace", added: 0, updated: 2, hidden: 4 })).toBe(
      "2 items updated, 0 items added, 4 items hidden.",
    );
  });
});
