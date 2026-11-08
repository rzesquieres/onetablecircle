/**
 * Pure functions that turn raw order rows into the consolidated view shown
 * to the waiter, and into delivery progress. No UI, no database access.
 */
import type { Assignee, DeliveryEvent, OrderItem } from "./types";

/** Normalise free text so "Iced Latte " and "iced  latte" group together. */
export function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Chosen options as text, in the order they were snapshotted, e.g. "Grande, Oat milk". */
export function optionsText(item: Pick<OrderItem, "options">): string {
  return (item.options ?? []).map((o) => o.option).join(", ");
}

/** Items with the same key are shown as one line, e.g. "3× Iced latte (Grande, Oat milk)". */
export function groupKey(item: Pick<OrderItem, "name" | "notes" | "unit_price_centavos"> & Partial<Pick<OrderItem, "options">>): string {
  const opts = (item.options ?? []).map((o) => normalizeText(`${o.group}:${o.option}`)).sort().join(",");
  return [normalizeText(item.name), opts, normalizeText(item.notes), item.unit_price_centavos ?? ""].join("|");
}

/** Units served per order item (sum of +1/-1 events, clamped to 0..quantity). */
export function servedCounts(items: OrderItem[], events: DeliveryEvent[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const e of events) sums.set(e.order_item_id, (sums.get(e.order_item_id) ?? 0) + e.delta);
  const out = new Map<string, number>();
  for (const item of items) {
    out.set(item.id, Math.min(item.quantity, Math.max(0, sums.get(item.id) ?? 0)));
  }
  return out;
}

export interface ConsolidatedLine {
  key: string;
  name: string;
  /** Chosen options, e.g. "Grande, Oat milk" ("" for none). */
  optionsText: string;
  notes: string;
  priceIsEstimate: boolean;
  unitPriceCentavos: number | null;
  quantity: number;
  served: number;
  /** Underlying order items, oldest first. */
  items: OrderItem[];
  /** Participant ids the line is for (union of all its items). */
  participantIds: string[];
  isShared: boolean;
}

function byCreated(a: OrderItem, b: OrderItem): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function consolidate(
  items: OrderItem[],
  assignees: Assignee[],
  events: DeliveryEvent[],
): ConsolidatedLine[] {
  const served = servedCounts(items, events);
  const forItem = new Map<string, string[]>();
  for (const a of assignees) {
    const list = forItem.get(a.order_item_id) ?? [];
    list.push(a.participant_id);
    forItem.set(a.order_item_id, list);
  }

  const lines = new Map<string, ConsolidatedLine>();
  for (const item of [...items].sort(byCreated)) {
    const key = groupKey(item);
    let line = lines.get(key);
    if (!line) {
      line = {
        key,
        name: item.name.trim(),
        optionsText: optionsText(item),
        notes: item.notes.trim(),
        priceIsEstimate: Boolean(item.price_is_estimate),
        unitPriceCentavos: item.unit_price_centavos,
        quantity: 0,
        served: 0,
        items: [],
        participantIds: [],
        isShared: false,
      };
      lines.set(key, line);
    }
    line.quantity += item.quantity;
    line.served += served.get(item.id) ?? 0;
    line.items.push(item);
    line.isShared ||= item.is_shared;
    line.priceIsEstimate ||= Boolean(item.price_is_estimate);
    for (const pid of forItem.get(item.id) ?? []) {
      if (!line.participantIds.includes(pid)) line.participantIds.push(pid);
    }
  }
  // Order lines by when they were first ordered.
  return [...lines.values()];
}

export interface Progress {
  served: number;
  total: number;
}

export function progress(lines: ConsolidatedLine[]): Progress {
  return lines.reduce(
    (acc, l) => ({ served: acc.served + l.served, total: acc.total + l.quantity }),
    { served: 0, total: 0 },
  );
}

/**
 * Which underlying order item a tap on a consolidated line applies to.
 * +1 (served): the oldest item that still has unserved units.
 * -1 (untick): the newest item that has served units.
 * Returns null if nothing can change.
 */
export function pickItemForTick(
  line: ConsolidatedLine,
  served: Map<string, number>,
  delta: 1 | -1,
): string | null {
  const ordered = [...line.items].sort(byCreated);
  if (delta === 1) {
    const item = ordered.find((i) => (served.get(i.id) ?? 0) < i.quantity);
    return item?.id ?? null;
  }
  const item = ordered.reverse().find((i) => (served.get(i.id) ?? 0) > 0);
  return item?.id ?? null;
}

export interface PersonalItem {
  item: OrderItem;
  served: number;
  sharedWith: number; // number of people on this item (1 = just you)
}

/** Items a participant is on (ordered for them or shared with them). */
export function itemsFor(
  participantId: string,
  items: OrderItem[],
  assignees: Assignee[],
  events: DeliveryEvent[],
): PersonalItem[] {
  const served = servedCounts(items, events);
  const people = new Map<string, Set<string>>();
  for (const a of assignees) {
    const set = people.get(a.order_item_id) ?? new Set<string>();
    set.add(a.participant_id);
    people.set(a.order_item_id, set);
  }
  return [...items]
    .sort(byCreated)
    .filter((i) => people.get(i.id)?.has(participantId))
    .map((item) => ({
      item,
      served: served.get(item.id) ?? 0,
      sharedWith: people.get(item.id)?.size ?? 1,
    }));
}
