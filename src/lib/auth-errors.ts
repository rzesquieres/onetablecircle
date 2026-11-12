/** Helpers for reading Supabase Auth errors (kept pure so they can be unit-tested). */

type AuthLikeError = { code?: unknown; message?: unknown } | null | undefined;

/** Signed in with email + password before clicking the confirmation link. */
export function isEmailNotConfirmed(error: unknown): boolean {
  const e = error as AuthLikeError;
  if (!e || typeof e !== "object") return false;
  return e.code === "email_not_confirmed" || /email not confirmed/i.test(String(e.message ?? ""));
}

/** Too many confirmation emails (per address or for the whole project). */
export function isEmailRateLimited(error: unknown): boolean {
  const e = error as AuthLikeError;
  if (!e || typeof e !== "object") return false;
  return (
    e.code === "over_email_send_rate_limit" ||
    /email rate limit|for security purposes, you can only request this/i.test(String(e.message ?? ""))
  );
}

/** Seconds to wait before the "Resend email" button works again. */
export const RESEND_COOLDOWN_SECONDS = 60;
