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
  discount: number;
  tip: number;
}

export interface BreakdownLine {
  lineId: string;
  description: string;
  amount: number;
  /** e.g. "shared by 3" */
  note: string;
}

export interface Share {
  participantId: string;
  items: number;
  service: number;
  tax: number;
  discount: number;
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
  participants: Pick<Participant, "id" | "joined_at">[];
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
    return known.map((x, i) => ({ pid: x.participantId, amount: parts[i], count: known.length }));
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
        give(s.pid, line, s.amount, s.count > 1 ? `shared by ${s.count}` : "");
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
        give(s.pid, line, s.amount, s.count > 1 ? `shared by ${s.count}` : "");
      }
    });
  }

  const { service, tax, discount, tip } = input.charges;
  if (discount > itemsTotal + service + tax + tip) problems.push("The discount is bigger than the bill");

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

  for (const s of shares) {
    s.total = s.items + s.service + s.tax + s.tip - s.discount;
    if (s.total < 0) problems.push("A discount is bigger than someone's share");
  }

  return { shares, itemsTotal, total: itemsTotal + service + tax + tip - discount, problems: [...new Set(problems)] };
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
 * Suggest which ordered items each receipt line pays for. Each item is used
 * once; a line takes the best-matching items until their quantities reach
 * the line's quantity. Returns item ids per line (same order as `lines`).
 */
export function suggestMatches(
  lines: { description: string; quantity: number }[],
  items: Pick<OrderItem, "id" | "name" | "quantity" | "options" | "created_at">[],
  threshold = 0.6,
): string[][] {
  const used = new Set<string>();
  const label = (i: (typeof items)[number]) => [i.name, ...(i.options ?? []).map((o) => o.option)].join(" ");
  return lines.map((line) => {
    const candidates = items
      .filter((i) => !used.has(i.id))
      .map((i) => ({ i, score: Math.max(similarity(line.description, i.name), similarity(line.description, label(i))) }))
      .filter((c) => c.score >= threshold)
      .sort((a, b) => b.score - a.score || (a.i.created_at < b.i.created_at ? -1 : 1));
    const picked: string[] = [];
    let qty = 0;
    for (const c of candidates) {
      if (qty >= Math.max(1, line.quantity)) break;
      picked.push(c.i.id);
      used.add(c.i.id);
      qty += c.i.quantity;
    }
    return picked;
  });
}
