"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";
import { supabaseConfigured } from "./supabase/env";

export interface CurrentUser {
  user: User | null;
  /** True for quick guests (Supabase anonymous sign-in). */
  isGuest: boolean;
  /** Platform admin (can manage stores and menus). The database enforces this too. */
  isAdmin: boolean;
  displayName: string;
  loading: boolean;
}

/** The signed-in user (null when signed out), kept in sync with auth changes. */
export function useUser(): CurrentUser {
  const [state, setState] = useState<CurrentUser>({
    user: null,
    isGuest: false,
    isAdmin: false,
    displayName: "",
    loading: supabaseConfigured,
  });

  useEffect(() => {
    if (!supabaseConfigured) return;
    const supabase = getSupabase();
    let cancelled = false;

    async function load(user: User | null) {
      let displayName = "";
      let isAdmin = false;
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("display_name, is_platform_admin")
          .eq("user_id", user.id)
          .maybeSingle();
        displayName = data?.display_name || user.email?.split("@")[0] || "";
        isAdmin = Boolean(data?.is_platform_admin);
      }
      if (!cancelled) setState({ user, isGuest: Boolean(user?.is_anonymous), isAdmin, displayName, loading: false });
    }

    supabase.auth.getUser().then(({ data }) => load(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // Defer: Supabase recommends not awaiting other calls inside this callback.
        setTimeout(() => load(session?.user ?? null), 0);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
