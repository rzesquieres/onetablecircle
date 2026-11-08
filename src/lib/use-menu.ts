"use client";

import { useCallback, useEffect, useState } from "react";
import { friendlyError, getSupabase } from "./supabase/client";
import type { Menu, Store } from "./types";

/** Load a store and its whole menu. Returns null if the store is not visible to you. */
export async function fetchMenu(storeId: string): Promise<Menu | null> {
  const supabase = getSupabase();
  const [s, c, i, g, o, l] = await Promise.all([
    supabase.from("stores").select("*").eq("id", storeId).maybeSingle(),
    supabase.from("menu_categories").select("*").eq("store_id", storeId).order("sort_order").order("name"),
    supabase.from("menu_items").select("*").eq("store_id", storeId).order("sort_order").order("name"),
    supabase.from("option_groups").select("*").eq("store_id", storeId).order("sort_order").order("name"),
    supabase.from("options").select("*").eq("store_id", storeId).order("sort_order").order("name"),
    supabase.from("menu_item_option_groups").select("*").eq("store_id", storeId).order("sort_order"),
  ]);
  const err = [s, c, i, g, o, l].find((r) => r.error)?.error;
  if (err) throw err;
  if (!s.data) return null;
  return {
    store: s.data as Store,
    categories: c.data ?? [],
    items: (i.data ?? []).map((x) => ({ ...x, base_price_centavos: Number(x.base_price_centavos) })),
    groups: g.data ?? [],
    options: (o.data ?? []).map((x) => ({ ...x, price_delta_centavos: Number(x.price_delta_centavos) })),
    links: l.data ?? [],
  };
}

/** The menu for a table's store (null storeId = free-text table, no menu). */
export function useMenu(storeId: string | null) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!storeId) return;
    try {
      setMenu(await fetchMenu(storeId));
      setError("");
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    fetchMenu(storeId)
      .then((m) => {
        if (!cancelled) setMenu(m);
      })
      .catch((e) => {
        if (!cancelled) setError(friendlyError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  return { menu: storeId ? menu : null, error, reload };
}
