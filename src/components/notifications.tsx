"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/types";

/**
 * Your unread in-app notifications (OTC-25), kept live. Each one shows until
 * you tap "OK", which marks it read. RLS only returns your own.
 */
export function Notifications({ userId }: { userId: string | null }) {
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await getSupabase()
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    // Before the OTC-25 migration the table doesn't exist; just show nothing.
    setItems((data as AppNotification[] | null) ?? []);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void load())
      // First load, and catch up on anything missed while (re)connecting.
      .subscribe((status) => status === "SUBSCRIBED" && void load());
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  async function dismiss(id: string) {
    setItems((list) => list.filter((n) => n.id !== id));
    await getSupabase().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  }

  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {items.map((n) => (
        <li key={n.id} className="flex items-start justify-between gap-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2">
          <p className="min-w-0 text-sm">
            {n.body}
            <span className="block text-xs text-ink-soft">
              {new Date(n.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
            </span>
          </p>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            className="min-h-9 shrink-0 rounded-lg px-3 text-sm font-semibold text-ink active:bg-muted"
          >
            OK
          </button>
        </li>
      ))}
    </ul>
  );
}
