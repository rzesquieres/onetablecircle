import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigured } from "./env";

let client: SupabaseClient | undefined;

/**
 * Browser Supabase client (singleton). Call it from event handlers and
 * effects only, never during render, so pages still build without keys.
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}

/** Turn a Supabase/Postgres error into a short message for people. */
export function friendlyError(error: unknown): string {
  const message =
    typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
  if (/row-level security/i.test(message)) {
    return "Not allowed right now. Ordering may be closed, or this isn't yours to change.";
  }
  if (/JWT|not signed in|sign in/i.test(message)) return "Please sign in again.";
  if (/Failed to fetch|NetworkError/i.test(message)) return "No connection. Check your internet and try again.";
  return message;
}
