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

  // Email confirmation links built from {{ .TokenHash }} (see docs/EMAIL-VERIFICATION.md).
  // Unlike ?code=, these work even if the link opens in a different browser or the mail app.
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (tokenHash && (type === "signup" || type === "email")) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  // e.g. sign-up refused by the invite-only hook ("OneTableCircle is in private testing…")
  const reason = request.nextUrl.searchParams.get("error_description");
  const url = new URL("/login", origin);
  url.searchParams.set(
    "error",
    reason
      ? reason.replace(/\+/g, " ").slice(0, 200)
      : "That link has expired or was already used. If you were confirming your email, try signing in: you can ask for a new link from there.",
  );
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}
