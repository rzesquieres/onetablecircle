import { describe, expect, it } from "vitest";
import { learnedPriceOff, matchTarget, receiptTextKey, suggestLineMatches, suggestMatches } from "./bill";

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  quantity: 1,
  options: [],
  created_at: id,
  menu_item_id: null as string | null,
  ...extra,
});

describe("receiptTextKey", () => {
  it("normalises case, punctuation, accents and a leading quantity", () => {
    expect(receiptTextKey("  CHKN-ADOBO w/ Rice ")).toBe("chkn adobo w rice");
    expect(receiptTextKey("2 ICED LATTE")).toBe("iced latte");
    expect(receiptTextKey("2x Iced Latte")).toBe("iced latte");
    expect(receiptTextKey("Jalapeño Poppers")).toBe("jalapeno poppers");
    expect(receiptTextKey("COKE 1.5L")).toBe("coke 1 5l");
  });
});

describe("matchTarget", () => {
  it("uses the menu item, or the typed-in name", () => {
    expect(matchTarget({ menu_item_id: "abc", name: "X" })).toBe("menu:abc");
    expect(matchTarget({ menu_item_id: null, name: "Sisig!" })).toBe("name:sisig");
  });
});

describe("suggestLineMatches", () => {
  const items = [
    item("a1", "Chicken Adobo with Rice", { menu_item_id: "m-adobo" }),
    item("s1", "Pork Sisig", { menu_item_id: "m-sisig" }),
    item("h1", "Halo-halo"),
  ];

  it("matches by name and marks it auto when nothing was learned", () => {
    const m = suggestLineMatches([{ description: "PORK SISIG", quantity: 1 }], items);
    expect(m).toEqual([{ itemIds: ["s1"], source: "auto" }]);
  });

  it("uses a learned match even when the names look nothing alike", () => {
    const m = suggestLineMatches(
      [
        { description: "SPCL #4", quantity: 1 },
        { description: "HH DESSERT", quantity: 1 },
        { description: "PORK SISIG", quantity: 1 },
      ],
      items,
      [
        { text_key: "spcl 4", target: "menu:m-adobo", score: 2 },
        { text_key: "hh dessert", target: "name:halo halo", score: 1 },
      ],
    );
    expect(m).toEqual([
      { itemIds: ["a1"], source: "learned" },
      { itemIds: ["h1"], source: "learned" },
      { itemIds: ["s1"], source: "auto" },
    ]);
  });

  it("learned matches win over name guesses, and items aren't used twice", () => {
    // "PORK SISIG" would guess s1, but the store learned "SIZZLING 1" = sisig.
    const m = suggestLineMatches(
      [
        { description: "PORK SISIG", quantity: 1 },
        { description: "SIZZLING 1", quantity: 1 },
      ],
      items,
      [{ text_key: "sizzling 1", target: "menu:m-sisig", score: 1 }],
    );
    expect(m).toEqual([
      { itemIds: [], source: null },
      { itemIds: ["s1"], source: "learned" },
    ]);
  });

  it("ignores pairs that were corrected away (score 0 or less) and picks the best score", () => {
    const m = suggestLineMatches([{ description: "SPCL 4", quantity: 1 }], items, [
      { text_key: "spcl 4", target: "menu:m-sisig", score: 0 },
      { text_key: "spcl 4", target: "menu:m-adobo", score: -1 },
    ]);
    expect(m).toEqual([{ itemIds: [], source: null }]);
    const best = suggestLineMatches([{ description: "SPCL 4", quantity: 1 }], items, [
      { text_key: "spcl 4", target: "menu:m-sisig", score: 1 },
      { text_key: "spcl 4", target: "menu:m-adobo", score: 3 },
    ]);
    expect(best).toEqual([{ itemIds: ["a1"], source: "learned" }]);
  });

  it("takes as many learned items as the line's quantity", () => {
    const two = [item("l1", "Latte", { menu_item_id: "m-l" }), item("l2", "Latte", { menu_item_id: "m-l" }), item("l3", "Latte", { menu_item_id: "m-l" })];
    const m = suggestLineMatches([{ description: "2 HOT LTE", quantity: 2 }], two, [
      { text_key: "hot lte", target: "menu:m-l", score: 1 },
    ]);
    expect(m).toEqual([{ itemIds: ["l1", "l2"], source: "learned" }]);
  });

  it("keeps the old suggestMatches result shape", () => {
    expect(suggestMatches([{ description: "PORK SISIG", quantity: 1 }], items)).toEqual([["s1"]]);
  });
});

describe("learnedPriceOff", () => {
  it("flags a line far from the ordered price", () => {
    expect(learnedPriceOff(25000, [{ unit_price_centavos: 25000, quantity: 1 }])).toBe(false);
    expect(learnedPriceOff(28000, [{ unit_price_centavos: 25000, quantity: 1 }])).toBe(false); // small menu price change
    expect(learnedPriceOff(50000, [{ unit_price_centavos: 25000, quantity: 1 }])).toBe(true);
    expect(learnedPriceOff(50000, [{ unit_price_centavos: 25000, quantity: 2 }])).toBe(false);
  });

  it("doesn't flag when there's no price to compare", () => {
    expect(learnedPriceOff(50000, [{ unit_price_centavos: null, quantity: 1 }])).toBe(false);
    expect(learnedPriceOff(50000, [])).toBe(false);
  });
});
