/**
 * Bill splitting: pure functions, integer centavos only.
 *
 * Rounding rule (deterministic): every amount is split with the "largest
 * remainder" method. Each person first gets the rounded-down share, then the
 * leftover centavos go one at a time to the largest fractional parts; ties
 * go to whoever joined the table first. So shares always add up exactly to
 * the amount being split, and the same input always gives the same result.
 */
import type { Assignee, OrderItem, Participant } from "./types";

/** Split `amount` centavos in proportion to `weights` (all >= 0). Equal split if every weight is 0. */
export function allocate(amount: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`Bad amount ${amount}`);
  if (weights.length === 0) {
    if (amount === 0) return [];
    throw new RangeError("Nobody to split between");
  }
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x) || x < 0) throw new RangeError(`Bad weight ${x}`);
    return BigInt(x);
  });
  // BigInt so amount × weight can't lose precision (subtotal weights can be large).
  const ZERO = BigInt(0);
  let total = w.reduce((a, b) => a + b, ZERO);
  const ws = total === ZERO ? w.map(() => BigInt(1)) : w;
  if (total === ZERO) total = BigInt(ws.length);
  const amt = BigInt(amount);

  const base = ws.map((x) => (amt * x) / total);
  const rem = ws.map((x) => (amt * x) % total);
  let left = Number(amt - base.reduce((a, b) => a + b, ZERO));
  const order = rem
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = base.map(Number);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

export type LineSplit = "items" | "people" | "everyone";

export interface BillLine {
  id: string;
  description: string;
  amount: number; // line total, centavos
  split: LineSplit;
  itemIds: string[]; // split = items
  people: { participantId: string; weight: number }[]; // split = people
}

export interface BillCharges {
  service: number;
  tax: number;
  /** Promos and other discounts, shared by everyone in proportion to their food. */
  discount: number;
  tip: number;
  /** Senior/PWD discount (VAT exemption + 20%), only for people marked Senior or PWD (OTC-31). */
  scPwdDiscount?: number;
}

export interface BreakdownLine {
  lineId: string;
  description: string;
  amount: number;
  /** e.g. "shared by 3", or "2 of 5 portions" when portions differ */
  note: string;
}

export interface Share {
  participantId: string;
  items: number;
  service: number;
  tax: number;
  discount: number;
  scPwdDiscount: number;
  tip: number;
  total: number;
  breakdown: BreakdownLine[];
}

export interface BillResult {
  shares: Share[];
  itemsTotal: number;
  total: number;
  /** Lines nobody pays for yet, or a discount bigger than the bill. Empty = ready to send. */
  problems: string[];
}

export interface BillInput {
  participants: (Pick<Participant, "id" | "joined_at"> & { sc_pwd?: Participant["sc_pwd"] })[];
  items: Pick<OrderItem, "id" | "quantity" | "created_at" | "added_by">[];
  assignees: Pick<Assignee, "order_item_id" | "participant_id" | "share_weight">[];
  lines: BillLine[];
  charges: BillCharges;
}

const byJoin = <T extends Pick<Participant, "id" | "joined_at">>(a: T, b: T) =>
  a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function computeBill(input: BillInput): BillResult {
  const people = [...input.participants].sort(byJoin);
  const index = new Map(people.map((p, i) => [p.id, i]));
  const shares: Share[] = people.map((p) => ({
    participantId: p.id,
    items: 0,
    service: 0,
    tax: 0,
    discount: 0,
    scPwdDiscount: 0,
    tip: 0,
    total: 0,
    breakdown: [],
  }));
  const problems: string[] = [];
  const itemById = new Map(input.items.map((i) => [i.id, i]));

  const give = (pid: string, line: BillLine, amount: number, note: string) => {
    const i = index.get(pid);
    if (i === undefined || amount === 0) return;
    shares[i].items += amount;
    const existing = shares[i].breakdown.find((b) => b.lineId === line.id);
    if (existing) existing.amount += amount;
    else shares[i].breakdown.push({ lineId: line.id, description: line.description, amount, note });
  };

  /** Split an amount among weighted people, in join order (for deterministic ties). */
  const splitAmong = (amount: number, list: { participantId: string; weight: number }[]) => {
    const known = list.filter((x) => index.has(x.participantId));
    known.sort((a, b) => index.get(a.participantId)! - index.get(b.participantId)!);
    const parts = allocate(amount, known.map((x) => x.weight));
    const totalWeight = known.reduce((a, x) => a + x.weight, 0);
    const even = known.every((x) => x.weight === known[0]?.weight);
    return known.map((x, i) => ({
      pid: x.participantId,
      amount: parts[i],
      count: known.length,
      note: known.length < 2 ? "" : even ? `shared by ${known.length}` : `${x.weight} of ${totalWeight} portions`,
    }));
  };

  let itemsTotal = 0;
  for (const line of input.lines) {
    itemsTotal += line.amount;
    if (line.split === "everyone") {
      for (const s of splitAmong(line.amount, people.map((p) => ({ participantId: p.id, weight: 1 })))) {
        give(s.pid, line, s.amount, `split ${s.count} ways`);
      }
      continue;
    }
    if (line.split === "people") {
      if (!line.people.length) {
        problems.push(`Choose who pays for "${line.description}"`);
        continue;
      }
      for (const s of splitAmong(line.amount, line.people)) {
        give(s.pid, line, s.amount, s.note);
      }
      continue;
    }
    // split = items: across matched items by quantity, then each item across whoever it's for.
    const matched = line.itemIds
      .map((id) => itemById.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
    if (!matched.length) {
      problems.push(`Match "${line.description}" to an ordered item, or choose who pays`);
      continue;
    }
    const perItem = allocate(line.amount, matched.map((m) => m.quantity));
    matched.forEach((item, k) => {
      let owners = input.assignees
        .filter((a) => a.order_item_id === item.id)
        .map((a) => ({ participantId: a.participant_id, weight: a.share_weight || 1 }));
      if (!owners.length) owners = [{ participantId: item.added_by, weight: 1 }];
      for (const s of splitAmong(perItem[k], owners)) {
        give(s.pid, line, s.amount, s.note);
      }
    });
  }

  const { service, tax, discount, tip } = input.charges;
  const scPwd = input.charges.scPwdDiscount ?? 0;
  if (discount + scPwd > itemsTotal + service + tax + tip) problems.push("The discount is bigger than the bill");

  // Charges follow each person's share of the food (equal split if nobody has any).
  const weights = shares.map((s) => s.items);
  const addCharge = (key: "service" | "tax" | "discount" | "tip", amount: number) => {
    if (!amount || !shares.length) return;
    allocate(amount, weights).forEach((v, i) => {
      shares[i][key] = v;
    });
  };
  addCharge("service", service);
  addCharge("tax", tax);
  addCharge("discount", discount);
  addCharge("tip", tip);

  // Senior/PWD discount: only the cardholders, in proportion to their own food.
  if (scPwd > 0) {
    const holders = people.map((p, i) => ({ p, i })).filter(({ p }) => p.sc_pwd);
    if (!holders.length) {
      problems.push("Mark who has a Senior or PWD ID in People, or remove the Senior/PWD discount");
    } else {
      allocate(scPwd, holders.map(({ i }) => shares[i].items)).forEach((v, k) => {
        shares[holders[k].i].scPwdDiscount = v;
      });
    }
  }

  for (const s of shares) {
    s.total = s.items + s.service + s.tax + s.tip - s.discount - s.scPwdDiscount;
    if (s.total < 0) problems.push("A discount is bigger than someone's share");
  }

  const total = itemsTotal + service + tax + tip - discount - shares.reduce((a, s) => a + s.scPwdDiscount, 0);
  return { shares, itemsTotal, total, problems: [...new Set(problems)] };
}

// ---------- Senior / PWD discount (OTC-31) ----------

/** VAT rate built into Philippine menu prices, in basis points (12%). */
export const PH_VAT_BPS = 1200;

/**
 * The Senior/PWD discount on `amount` centavos of a cardholder's food:
 * remove VAT (if prices include it), then take 20% off what's left.
 * Returns the whole reduction (VAT exemption + 20%), rounded to the centavo.
 */
export function scPwdDiscountFor(amount: number, vatInclusive = true): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`Bad amount ${amount}`);
  // Integer rounding (half up) so there are no float errors.
  const exVat = vatInclusive ? Math.floor((amount * 20000 + (10000 + PH_VAT_BPS)) / (2 * (10000 + PH_VAT_BPS))) : amount;
  const twenty = Math.floor((exVat * 2 + 5) / 10);
  return amount - exVat + twenty;
}

/**
 * What the Senior/PWD discount should be for this bill: the formula applied to
 * each cardholder's share of the food. Use it when the receipt doesn't show one.
 */
export function suggestedScPwdDiscount(result: BillResult, participants: { id: string; sc_pwd?: string | null }[], vatInclusive = true): number {
  const holders = new Set(participants.filter((p) => p.sc_pwd).map((p) => p.id));
  return result.shares.filter((s) => holders.has(s.participantId)).reduce((a, s) => a + scPwdDiscountFor(s.items, vatInclusive), 0);
}

// ---------- Matching receipt lines to ordered items ----------

const STOP = new Set(["the", "and", "with", "w", "of", "a", "ala", "de", "sa", "ng", "pcs", "pc", "x", "order", "regular", "reg"]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

/** Receipt abbreviation: "pltr" ~ "platter", "chkn" ~ "chicken" (same first letter, letters in order). */
function isAbbreviation(short: string, long: string): boolean {
  if (short.length < 3 || short.length >= long.length || short[0] !== long[0]) return false;
  let j = 0;
  for (const ch of long) if (ch === short[j]) j++;
  return j === short.length;
}

/** How alike two names are, 0..1. Handles receipt styles like "ICED LATTE GRANDE" and "NACHOS PLTR". */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const hit = (x: string, list: string[]) =>
    list.some(
      (y) =>
        x === y ||
        (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))) ||
        isAbbreviation(x, y) ||
        isAbbreviation(y, x),
    );
  const common = ta.filter((x) => hit(x, tb)).length;
  return common / Math.min(ta.length, tb.length);
}

/**
 * Receipt text as a lookup key for learned matches (OTC-29): lower case,
 * accents and punctuation removed, a leading quantity ("2 ", "2x ") dropped.
 * Must stay the same as public.receipt_text_key() in the database.
 */
export function receiptTextKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^[0-9]+ ?x? /, "");
}

/**
 * What a receipt line was matched to, as stored in learned matches: the menu
 * item, or for typed-in orders the order's name. Same as
 * public.order_item_match_target().
 */
export function matchTarget(item: Pick<OrderItem, "menu_item_id" | "name">): string {
  return item.menu_item_id ? `menu:${item.menu_item_id}` : `name:${receiptTextKey(item.name)}`;
}

/** A (receipt text -> item) pair the store has learned, with its net confirmations. */
export interface LearnedMatch {
  text_key: string;
  target: string;
  score: number;
}

export type MatchSource = "learned" | "auto";
export interface LineMatch {
  itemIds: string[];
  /** "learned" when the match came from earlier receipts at this store. */
  source: MatchSource | null;
}

type MatchItem = Pick<OrderItem, "id" | "name" | "quantity" | "options" | "created_at"> &
  Partial<Pick<OrderItem, "menu_item_id">>;

/**
 * Suggest which ordered items each receipt line pays for. Each item is used
 * once; a line takes items until their quantities reach the line's quantity.
 * Lines whose text the store has learned (`learned`) are matched that way
 * first; the rest are matched by how alike the names are.
 */
export function suggestLineMatches(
  lines: { description: string; quantity: number }[],
  items: MatchItem[],
  learned: LearnedMatch[] = [],
  threshold = 0.6,
): LineMatch[] {
  const used = new Set<string>();
  const byCreated = (a: MatchItem, b: MatchItem) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
  const take = (line: { quantity: number }, candidates: MatchItem[]) => {
    const picked: string[] = [];
    let qty = 0;
    for (const i of candidates) {
      if (qty >= Math.max(1, line.quantity)) break;
      if (used.has(i.id)) continue;
      picked.push(i.id);
      used.add(i.id);
      qty += i.quantity;
    }
    return picked;
  };

  const known = new Map<string, LearnedMatch[]>();
  for (const m of learned) {
    if (m.score <= 0) continue;
    const list = known.get(m.text_key) ?? [];
    list.push(m);
    known.set(m.text_key, list);
  }

  // 1. What earlier receipts at this store taught us.
  const result: LineMatch[] = lines.map((line) => {
    const options = [...(known.get(receiptTextKey(line.description)) ?? [])].sort(
      (a, b) => b.score - a.score || (a.target < b.target ? -1 : 1),
    );
    const candidates = options.flatMap((m) =>
      items.filter((i) => matchTarget({ menu_item_id: i.menu_item_id ?? null, name: i.name }) === m.target).sort(byCreated),
    );
    const itemIds = take(line, candidates);
    return { itemIds, source: itemIds.length ? "learned" : null };
  });

  // 2. Guess by name for the rest.
  const label = (i: MatchItem) => [i.name, ...(i.options ?? []).map((o) => o.option)].join(" ");
  lines.forEach((line, n) => {
    if (result[n].itemIds.length) return;
    const candidates = items
      .filter((i) => !used.has(i.id))
      .map((i) => ({ i, score: Math.max(similarity(line.description, i.name), similarity(line.description, label(i))) }))
      .filter((c) => c.score >= threshold)
      .sort((a, b) => b.score - a.score || byCreated(a.i, b.i))
      .map((c) => c.i);
    const itemIds = take(line, candidates);
    result[n] = { itemIds, source: itemIds.length ? "auto" : null };
  });
  return result;
}

/** Item ids per line, matching by name only. */
export function suggestMatches(
  lines: { description: string; quantity: number }[],
  items: MatchItem[],
  threshold = 0.6,
): string[][] {
  return suggestLineMatches(lines, items, [], threshold).map((m) => m.itemIds);
}

/**
 * For a learned match: true when the line's amount is far from what the
 * matched items cost when ordered (over 25% off), so the host should check
 * it. False when any matched item has no price (nothing to compare).
 */
export function learnedPriceOff(
  lineAmount: number,
  items: Pick<OrderItem, "unit_price_centavos" | "quantity">[],
): boolean {
  if (!items.length || items.some((i) => i.unit_price_centavos === null)) return false;
  const expected = items.reduce((a, i) => a + (i.unit_price_centavos ?? 0) * i.quantity, 0);
  if (expected <= 0) return lineAmount > 0;
  return Math.abs(lineAmount - expected) * 4 > expected;
}
