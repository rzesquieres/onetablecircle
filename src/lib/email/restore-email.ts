/** The "your account has been restored" email (OTC-18). Pure, so it's unit-tested. */

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface RestoreEmailInput {
  /** Public site origin, e.g. "https://onetablecircle.com" (no trailing slash). */
  origin: string;
  name: string;
  /** True when their sign-in methods weren't kept, so they need "Forgot password" (or Google). */
  needsPasswordReset: boolean;
}

export function restoreEmail({ origin, name, needsPasswordReset }: RestoreEmailInput) {
  const signIn = `${origin}/login`;
  const forgot = `${origin}/login?mode=forgot`;
  const hi = name.trim() ? `Hi ${name.trim()},` : "Hi,";
  const subject = "Your OneTableCircle account has been restored";

  const text = [
    hi,
    "",
    "Good news: your OneTableCircle account has been restored. Your tables, bills and saved groups are back as they were.",
    "",
    needsPasswordReset
      ? `To get back in, set a new password here: ${forgot}\nIf you used Google before, you can also just choose "Continue with Google" at ${signIn}.`
      : `Sign in here: ${signIn}`,
    "",
    "If you didn't expect this email, you can ignore it.",
    "",
    "OneTableCircle",
  ].join("\n");

  const button = (href: string, label: string) =>
    `<a href="${escape(href)}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">${escape(label)}</a>`;

  const html = `<h2>Your account is back</h2>
<p>${escape(hi)}</p>
<p>Good news: your OneTableCircle account has been restored. Your tables, bills and saved groups are back as they were.</p>
${
  needsPasswordReset
    ? `<p>To get back in, set a new password. If you used Google before, you can also just choose "Continue with Google" on the sign-in page.</p>
<p>${button(forgot, "Set a new password")}</p>`
    : `<p>${button(signIn, "Sign in to OneTableCircle")}</p>`
}
<p style="color:#666;font-size:13px">If you didn't expect this email, you can ignore it.</p>`;

  return { subject, text, html };
}
