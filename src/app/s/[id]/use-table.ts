"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import type { Assignee, DeliveryEvent, OrderItem, Participant, Session } from "@/lib/types";

export interface TableData {
  session: Session;
  participants: Participant[];
  items: OrderItem[];
  assignees: Assignee[];
  events: DeliveryEvent[];
}

const TABLES = ["participants", "order_items", "order_item_assignees", "delivery_events"] as const;

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
    const [s, p, i, a, e] = await Promise.all([
      supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("participants").select("*").eq("session_id", sessionId).order("joined_at"),
      supabase.from("order_items").select("*").eq("session_id", sessionId).order("created_at"),
      supabase.from("order_item_assignees").select("*").eq("session_id", sessionId),
      supabase.from("delivery_events").select("*").eq("session_id", sessionId).order("id"),
    ]);
    const firstError = [s, p, i, a, e].find((r) => r.error)?.error;
    if (firstError) {
      setError(friendlyError(firstError));
      return;
    }
    if (!s.data) {
      setError("This table doesn't exist, or you're not part of it. Ask the host for the join link.");
      return;
    }
    setError("");
    setData({
      session: s.data as Session,
      participants: (p.data ?? []) as Participant[],
      items: (i.data ?? []) as OrderItem[],
      assignees: (a.data ?? []) as Assignee[],
      events: (e.data ?? []) as DeliveryEvent[],
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
    for (const table of TABLES) {
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
