import type { Payment, Session } from "./types";

/** Mirrors public.session_accepts_orders() in the database. */
export function acceptsOrders(session: Pick<Session, "status" | "order_cutoff_at">, now: Date): boolean {
  if (session.status !== "open") return false;
  if (!session.order_cutoff_at) return true;
  return new Date(session.order_cutoff_at).getTime() > now.getTime();
}

/** Mirrors public.session_is_active(): serving can be ticked until billing starts. */
export function isActive(session: Pick<Session, "status">): boolean {
  return session.status === "open" || session.status === "closed";
}

/** Mirrors public.bill_is_paid(): someone has marked a payment, or the table is settled. */
export function billIsPaid(
  session: Pick<Session, "status">,
  payments: Pick<Payment, "marked_paid_at">[],
): boolean {
  return session.status === "settled" || payments.some((p) => p.marked_paid_at !== null);
}

/**
 * Mirrors public.remove_order_item() (OTC-25): the person who ordered it, or
 * the table's creator, until the bill is paid.
 */
export function canRemoveItem(
  session: Pick<Session, "status">,
  payments: Pick<Payment, "marked_paid_at">[],
  addedBy: string,
  me: { id: string; isHost: boolean },
): boolean {
  return (addedBy === me.id || me.isHost) && !billIsPaid(session, payments);
}

/**
 * Mirrors public.edit_order_item() (OTC-27): same people and same window as
 * removing.
 */
export const canEditItem = canRemoveItem;

export interface ItemEdit {
  quantity: number;
  notes: string;
  isShared: boolean;
  forIds: string[];
}

/**
 * Mirrors edit_order_item()'s "nothing changed" check: an unchanged save
 * doesn't take a sent bill back or notify anyone.
 */
export function editChangesItem(
  item: { quantity: number; notes: string; is_shared: boolean },
  currentForIds: string[],
  next: ItemEdit,
): boolean {
  const sorted = (ids: string[]) => [...new Set(ids)].sort().join(",");
  return (
    item.quantity !== next.quantity ||
    item.notes !== next.notes.trim().slice(0, 200) ||
    item.is_shared !== next.isShared ||
    sorted(currentForIds) !== sorted(next.forIds)
  );
}

/** Why an edit can't be saved, or null if it can (same checks as the database). */
export function editProblem(next: ItemEdit): string | null {
  if (!Number.isInteger(next.quantity) || next.quantity < 1 || next.quantity > 99) return "Quantity should be between 1 and 99.";
  const ids = new Set(next.forIds);
  if (ids.size === 0) return "Choose who this is for.";
  if (!next.isShared && ids.size !== 1) return "A non-shared item is for exactly one person.";
  return null;
}
