import { describe, expect, it } from "vitest";
import { AiMenuSchema, countIncluded, draftProblems, priceText, toApplyPayload, toDraft, type ImportResult } from "./menu-draft";

const result: ImportResult = {
  sources: ["not a url", "https://kape.example/menu"],
  warnings: [],
  menu: {
    store_name: " Kape  Ni Juan ",
    branch: null,
    currency: "PHP",
    option_groups: [
      {
        name: "Size",
        selection: "single",
        required: true,
        max_choices: 5,
        options: [
          { name: "Regular", price_change: "0" },
          { name: "Large", price_change: "₱20.00" },
        ],
      },
      { name: "Empty", selection: "multi", required: false, max_choices: null, options: [] },
    ],
    categories: [
      {
        name: "Coffee",
        items: [
          { name: "Spanish Latte", description: "Sweet", price: "P165", option_groups: ["Size", "Nonexistent"] },
          { name: "Americano", description: "", price: null, option_groups: [] },
        ],
      },
      { name: "coffee", items: [{ name: "Mocha", description: "", price: "1,250.5", option_groups: [] }] },
      { name: "Empty category", items: [] },
    ],
    warnings: ["Prices may be outdated"],
  },
};

describe("priceText", () => {
  it("reads common Philippine menu price formats", () => {
    expect(priceText("₱1,250")).toBe("1250");
    expect(priceText("P95")).toBe("95");
    expect(priceText("180.50")).toBe("180.50");
    expect(priceText("PHP 99")).toBe("99");
    expect(priceText("-10")).toBe("-10");
    expect(priceText("market price")).toBe("");
    expect(priceText(null)).toBe("");
  });
});

describe("toDraft", () => {
  const d = toDraft(result, { existingItemNames: ["americano"] });

  it("cleans names, merges same-named categories, drops empties", () => {
    expect(d.storeName).toBe("Kape Ni Juan");
    expect(d.sourceUrl).toBe("https://kape.example/menu");
    expect(d.groups.map((g) => g.name)).toEqual(["Size"]);
    expect(d.groups[0].maxChoices).toBeNull(); // single choice ignores max
    expect(d.categories.map((c) => [c.name, c.items.length])).toEqual([["Coffee", 3]]);
  });

  it("keeps only known option groups and marks duplicates unticked", () => {
    const [latte, americano, mocha] = d.categories[0].items;
    expect(latte.groups).toEqual(["Size"]);
    expect(latte.price).toBe("165");
    expect(americano).toMatchObject({ duplicate: true, include: false, price: "" });
    expect(mocha.price).toBe("1250.50");
    expect(countIncluded(d)).toBe(2);
  });
});

describe("draftProblems and toApplyPayload", () => {
  it("requires a price on every ticked item", () => {
    const d = toDraft(result);
    expect(draftProblems(d)).toEqual(['Set a price for "Americano" (or untick it)']);
    d.categories[0].items[1].price = "120";
    expect(draftProblems(d)).toEqual([]);
  });

  it("converts to centavos and leaves out unticked things", () => {
    const d = toDraft(result);
    d.categories[0].items[1].include = false;
    const p = toApplyPayload(d);
    expect(p.option_groups).toEqual([
      {
        name: "Size",
        selection: "single",
        min_select: 1,
        max_select: null,
        options: [
          { name: "Regular", price_delta_centavos: 0 },
          { name: "Large", price_delta_centavos: 2000 },
        ],
      },
    ]);
    expect(p.categories[0].items).toEqual([
      { name: "Spanish Latte", description: "Sweet", base_price_centavos: 16500, option_groups: ["Size"] },
      { name: "Mocha", description: "", base_price_centavos: 125050, option_groups: [] },
    ]);
    d.groups[0].include = false;
    expect(toApplyPayload(d).categories[0].items[0].option_groups).toEqual([]);
  });
});

describe("AiMenuSchema", () => {
  it("accepts the model's shape and rejects junk", () => {
    expect(AiMenuSchema.safeParse(result.menu).success).toBe(true);
    expect(AiMenuSchema.safeParse({ categories: "nope" }).success).toBe(false);
  });
});
