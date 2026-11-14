import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  dinerCategoryRank,
  orderCategories,
  orderedAtTable,
  groupsForItem,
  optionsLabel,
  photoUrl,
  selectionProblems,
  toggleOption,
  unitPrice,
} from "./menu";
import type { ItemGroupLink, MenuOption, OptionGroup } from "./types";

const group = (id: string, name: string, p: Partial<OptionGroup> = {}): OptionGroup => ({
  id,
  store_id: "s",
  name,
  selection: "single",
  min_select: 0,
  max_select: null,
  sort_order: 0,
  ...p,
});
const option = (id: string, groupId: string, name: string, delta = 0, p: Partial<MenuOption> = {}): MenuOption => ({
  id,
  store_id: "s",
  option_group_id: groupId,
  name,
  price_delta_centavos: delta,
  is_default: false,
  sort_order: 0,
  ...p,
});
const link = (item: string, groupId: string, sort = 0): ItemGroupLink => ({
  menu_item_id: item,
  option_group_id: groupId,
  store_id: "s",
  sort_order: sort,
});

const menu = {
  groups: [
    group("size", "Size", { min_select: 1 }),
    group("addons", "Add-ons", { selection: "multi", max_select: 2 }),
    group("unused", "Unused"),
  ],
  options: [
    option("tall", "size", "Tall", 0, { is_default: true, sort_order: 0 }),
    option("grande", "size", "Grande", 2000, { sort_order: 1 }),
    option("oat", "addons", "Oat milk", 3000),
    option("shot", "addons", "Extra shot", 4000),
    option("syrup", "addons", "Syrup", 2500, { is_default: true }),
  ],
  links: [link("latte", "addons", 1), link("latte", "size", 0)],
};

describe("groupsForItem", () => {
  it("returns only linked groups, in link order, with sorted options", () => {
    const g = groupsForItem(menu, "latte");
    expect(g.map((x) => x.group.name)).toEqual(["Size", "Add-ons"]);
    expect(g[0].options.map((o) => o.name)).toEqual(["Tall", "Grande"]);
    expect(g[1].options.map((o) => o.name)).toEqual(["Extra shot", "Oat milk", "Syrup"]);
  });
});

describe("selection", () => {
  const g = groupsForItem(menu, "latte");

  it("starts with each group's defaults", () => {
    expect(defaultSelection(g).sort()).toEqual(["syrup", "tall"]);
  });

  it("single-choice groups swap; multi-choice groups stop at the maximum", () => {
    let s = ["tall"];
    s = toggleOption(g, s, "grande");
    expect(s).toEqual(["grande"]);
    s = toggleOption(g, s, "oat");
    s = toggleOption(g, s, "shot");
    s = toggleOption(g, s, "syrup"); // third add-on ignored (max 2)
    expect(s.sort()).toEqual(["grande", "oat", "shot"]);
    s = toggleOption(g, s, "oat"); // untick
    expect(s.sort()).toEqual(["grande", "shot"]);
  });

  it("reports missing required choices", () => {
    expect(selectionProblems(g, [])).toEqual(["Please choose size"]);
    expect(selectionProblems(g, ["tall"])).toEqual([]);
  });

  it("adds option prices to the base price (integer centavos)", () => {
    expect(unitPrice({ base_price_centavos: 16000 }, g, ["grande", "oat", "shot"])).toBe(25000);
  });
});

describe("labels and photos", () => {
  it("joins chosen option names", () => {
    expect(optionsLabel([{ option: "Grande" }, { option: "Oat milk" }])).toBe("Grande, Oat milk");
  });
  it("builds a public Storage URL", () => {
    expect(photoUrl("https://abc.supabase.co/", "store-1/latte 1.jpg")).toBe(
      "https://abc.supabase.co/storage/v1/object/public/menu-photos/store-1/latte%201.jpg",
    );
    expect(photoUrl("https://abc.supabase.co", null)).toBeNull();
  });
});

describe("diner-friendly category order (OTC-24)", () => {
  const cat = (id: string, name: string, sort_order: number) => ({ id, name, sort_order });
  const cats = [
    cat("d", "Desserts", 0),
    cat("b", "Drinks", 1),
    cat("m", "Rice Meals", 2),
    cat("s", "Sides", 3),
    cat("a", "Appetizers", 4),
    cat("p", "Bestsellers", 5),
    cat("f", "Good for Sharing", 6),
    cat("x", "Merienda Corner", 7),
    cat("e", "Empty section", 8),
  ];
  const items = ["d", "b", "m", "s", "a", "p", "f", "x"].map((category_id) => ({ category_id }));

  it("ranks common Filipino menu section names", () => {
    expect(dinerCategoryRank("Best Sellers")).toBe(0);
    expect(dinerCategoryRank("Pulutan")).toBe(1);
    expect(dinerCategoryRank("Silog Meals")).toBe(2);
    expect(dinerCategoryRank("Barkada Platters")).toBe(3);
    expect(dinerCategoryRank("Add-ons")).toBe(5);
    expect(dinerCategoryRank("Milk Tea")).toBe(7);
    expect(dinerCategoryRank("Halo-Halo")).toBe(8);
  });

  it("puts popular first, then starters, mains, sharing, sides, other, drinks, desserts; hides empty ones", () => {
    expect(orderCategories(cats, items).map((c) => c.id)).toEqual(["p", "a", "m", "f", "s", "x", "b", "d"]);
  });

  it("keeps the admin's order within a group", () => {
    const two = [cat("m2", "Pasta", 1), cat("m1", "Grill", 0)];
    expect(orderCategories(two, [{ category_id: "m1" }, { category_id: "m2" }]).map((c) => c.id)).toEqual(["m1", "m2"]);
  });

  it("uses only the admin's order when the store has a custom order", () => {
    expect(orderCategories(cats, items, true).map((c) => c.id)).toEqual(["d", "b", "m", "s", "a", "p", "f", "x"]);
  });
});

describe("ordered at this table", () => {
  const item = (id: string, is_available = true) => ({ id, is_available });
  it("lists available menu items by quantity ordered, then most recent", () => {
    const menuItems = [item("a"), item("b"), item("c"), item("gone", false), item("never")];
    const orders = [
      { menu_item_id: "a", quantity: 1, created_at: "2026-11-14T10:00:00Z" },
      { menu_item_id: "b", quantity: 2, created_at: "2026-11-14T09:00:00Z" },
      { menu_item_id: "c", quantity: 1, created_at: "2026-11-14T11:00:00Z" },
      { menu_item_id: "gone", quantity: 5, created_at: "2026-11-14T11:00:00Z" },
      { menu_item_id: null, quantity: 3, created_at: "2026-11-14T11:00:00Z" },
    ];
    expect(orderedAtTable(menuItems, orders).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
});
