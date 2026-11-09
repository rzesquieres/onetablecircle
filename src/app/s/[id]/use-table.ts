"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import type {
  Assignee,
  BillShareRow,
  DeliveryEvent,
  OrderItem,
  Participant,
  Payment,
  Receipt,
  ReceiptLine,
  ReceiptLineItem,
  ReceiptLinePerson,
  Session,
} from "@/lib/types";

export interface TableData {
  session: Session;
  participants: Participant[];
  items: OrderItem[];
  assignees: Assignee[];
  events: DeliveryEvent[];
  /** The bill (Phase 5): null until the host starts it. */
  receipt: Receipt | null;
  lines: ReceiptLine[];
  lineItems: ReceiptLineItem[];
  linePeople: ReceiptLinePerson[];
  shares: BillShareRow[];
  payments: Payment[];
}

const LIVE_TABLES = [
  "participants",
  "order_items",
  "order_item_assignees",
  "delivery_events",
  "receipts",
  "bill_shares",
  "payments",
] as const;

const num = <T extends Record<string, unknown>>(rows: T[] | null, keys: (keyof T)[]): T[] =>
  (rows ?? []).map((r) => {
    const copy = { ...r };
    for (const k of keys) if (copy[k] !== null && copy[k] !== undefined) (copy as Record<keyof T, unknown>)[k] = Number(copy[k]);
    return copy;
  });

/**
 * Loads everything for one table and keeps it live: any change by anyone
 * at the table triggers a quick re-fetch (simple and always consistent).
 */
export function useTable(sessionId: string) {
  const [data, setData] = useState<TableData | null>(null);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [s, p, i, a, e, r, l, li, lp, sh, pay] = await Promise.all([
      supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("participants").select("*").eq("session_id", sessionId).order("joined_at"),
      supabase.from("order_items").select("*").eq("session_id", sessionId).order("created_at"),
      supabase.from("order_item_assignees").select("*").eq("session_id", sessionId),
      supabase.from("delivery_events").select("*").eq("session_id", sessionId).order("id"),
      supabase.from("receipts").select("*").eq("session_id", sessionId).maybeSingle(),
      supabase.from("receipt_lines").select("*").eq("session_id", sessionId).order("sort_order"),
      supabase.from("receipt_line_items").select("*").eq("session_id", sessionId),
      supabase.from("receipt_line_people").select("*").eq("session_id", sessionId),
      supabase.from("bill_shares").select("*").eq("session_id", sessionId),
      supabase.from("payments").select("*").eq("session_id", sessionId),
    ]);
    const firstError = [s, p, i, a, e, r, l, li, lp, sh, pay].find((x) => x.error)?.error;
    if (firstError) {
      setError(friendlyError(firstError));
      return;
    }
    if (!s.data) {
      setError("This table was deleted, or you're not part of it. Ask the host for the join link.");
      return;
    }
    setError("");
    const receipt = r.data
      ? (num([r.data], [
          "service_charge_centavos",
          "tax_centavos",
          "discount_centavos",
          "tip_centavos",
          "printed_total_centavos",
        ])[0] as unknown as Receipt)
      : null;
    setData({
      session: s.data as Session,
      participants: (p.data ?? []) as Participant[],
      items: num(i.data, ["unit_price_centavos"]) as unknown as OrderItem[],
      assignees: (a.data ?? []) as Assignee[],
      events: (e.data ?? []) as DeliveryEvent[],
      receipt,
      lines: num(l.data, ["amount_centavos"]) as unknown as ReceiptLine[],
      lineItems: (li.data ?? []) as ReceiptLineItem[],
      linePeople: (lp.data ?? []) as ReceiptLinePerson[],
      shares: num(sh.data, [
        "items_centavos",
        "service_centavos",
        "tax_centavos",
        "discount_centavos",
        "tip_centavos",
        "total_centavos",
      ]) as unknown as BillShareRow[],
      payments: (pay.data ?? []) as Payment[],
    });
  }, [sessionId]);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 120);
  }, [load]);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    refresh(); // initial load

    let channel = supabase
      .channel(`table:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, refresh);
    for (const table of LIVE_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `session_id=eq.${sessionId}` },
        refresh,
      );
    }
    channel.subscribe((status) => {
      // Catch up on anything missed while (re)connecting.
      if (status === "SUBSCRIBED") refresh();
    });

    // Phones pause background tabs; re-sync when the app comes back.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, load, refresh]);

  const me = data?.participants.find((p) => p.user_id === userId) ?? null;
  const isHost = Boolean(data && userId && data.session.host_id === userId);

  return { data, error, me, isHost, reload: load };
}
