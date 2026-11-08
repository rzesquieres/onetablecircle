import type { Session } from "./types";

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
