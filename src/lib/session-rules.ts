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
