import type { NextRequest } from "next/server";
import { restoreEmail } from "@/lib/email/restore-email";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { publicOrigin } from "@/lib/site";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * Restore a removed user (OTC-18), then email them that they're back.
 * Body: { userId, reason?, addToTesters? }.
 * The admin check happens in the database (admin_restore_user). If the email
 * can't be sent, the restore still stands and the response says so.
 */
export async function POST(request: NextRequest) {
  if (!supabaseConfigured) return fail(503, "The app isn't connected to its database yet.");
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail(401, "Please sign in again.");

  const body = (await request.json().catch(() => null)) as
    | { userId?: unknown; reason?: unknown; addToTesters?: unknown }
    | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail(400, "Missing user.");
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  const addToTesters = typeof body?.addToTesters === "boolean" ? body.addToTesters : null;

  const { data, error } = await supabase.rpc("admin_restore_user", {
    p_user_id: userId,
    p_reason: reason,
    p_add_to_testers: addToTesters,
  });
  if (error) return fail(error.code === "42501" ? 403 : 400, error.message);
  const restored = (Array.isArray(data) ? data[0] : data) as
    | { email: string | null; display_name: string; needs_password_reset: boolean }
    | undefined;
  if (!restored) return fail(500, "Restore didn't return the account.");

  let emailSent = false;
  let emailError: string | undefined;
  if (!restored.email) {
    emailError = "The account has no email address.";
  } else if (!emailConfigured()) {
    emailError = "No email provider is set up yet (RESEND_API_KEY or BREVO_API_KEY).";
  } else {
    try {
      await sendEmail({
        to: restored.email,
        ...restoreEmail({
          origin: publicOrigin(request),
          name: restored.display_name,
          needsPasswordReset: restored.needs_password_reset,
        }),
      });
      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      console.error("Restore email failed", emailError);
    }
  }

  return Response.json({
    email: restored.email,
    displayName: restored.display_name,
    needsPasswordReset: restored.needs_password_reset,
    emailSent,
    emailError,
  });
}
