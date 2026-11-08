import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { publicOrigin, safeNextPath } from "@/lib/site";

// Google sign-in and email confirmation links land here with ?code=...
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  const url = new URL("/login", origin);
  url.searchParams.set("error", "Sign-in link expired or was opened in a different browser. Please try again.");
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}
