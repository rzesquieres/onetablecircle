import "server-only";

/**
 * Sends an email from the app (not one of Supabase's own auth emails) through
 * the same provider used for Supabase custom SMTP. Set ONE of:
 *   RESEND_API_KEY  (https://resend.com)  or  BREVO_API_KEY  (https://brevo.com)
 * and optionally EMAIL_FROM (default "OneTableCircle <no-reply@onetablecircle.com>").
 * The sender domain must be verified with the provider (docs/EMAIL-VERIFICATION.md).
 */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_FROM = "OneTableCircle <no-reply@onetablecircle.com>";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
}

/** Split "Name <addr>" into its parts. */
function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || "OneTableCircle", email: m[2] } : { name: "OneTableCircle", email: from.trim() };
}

/** Throws with a short reason if the email couldn't be sent. */
export async function sendEmail(email: Email): Promise<void> {
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const signal = AbortSignal.timeout(15_000);

  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      signal,
    });
    if (!res.ok) throw new Error(`Resend said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }

  if (process.env.BREVO_API_KEY) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: parseFrom(from),
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Brevo said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }

  throw new Error("No email provider is set up (add RESEND_API_KEY or BREVO_API_KEY).");
}
