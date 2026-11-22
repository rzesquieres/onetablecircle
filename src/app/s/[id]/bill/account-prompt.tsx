"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Input, Label, Notice } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";

/**
 * OTC-36: "Save this bill: create an account." Shown to guests once the bill
 * is sent, after the rating prompt. Upgrading keeps the same user (Supabase
 * links Google or an email to the guest), so this table and its payments stay
 * theirs. "Not now" hides it for this table.
 */
export function AccountPrompt({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<"checking" | "ask" | "email" | "sent" | "hidden">("checking");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .rpc("account_prompt_due", { p_session_id: sessionId })
      .then(({ data, error }) => {
        // If anything goes wrong (e.g. the migration isn't in yet), just don't ask.
        if (!cancelled) setState(!error && data === true ? "ask" : "hidden");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const callback = (next: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setBusy(true);
    setError("");
    const { error } = await getSupabase().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: callback(`/s/${sessionId}`) },
    });
    // On success the browser goes to Google, so we only get here on an error.
    if (error) {
      setBusy(false);
      setError(
        /already|exists|linked/i.test(error.message)
          ? "That Google account already has a OneTableCircle account. Use email instead, or sign in later from the home page."
          : /manual linking/i.test(error.message)
            ? "Saving with Google isn't switched on yet. Use email instead."
            : friendlyError(error),
      );
    }
  }

  async function saveEmail(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    // Confirming the email turns the guest into a full account; then they choose a password.
    const { error } = await getSupabase().auth.updateUser({ email: value }, { emailRedirectTo: callback("/reset-password") });
    setBusy(false);
    if (error) {
      return setError(
        /already/i.test(error.message)
          ? "That email already has an account. Sign in with it later from the home page."
          : friendlyError(error),
      );
    }
    setState("sent");
  }

  async function notNow() {
    setState("hidden");
    await getSupabase().rpc("dismiss_account_prompt", { p_session_id: sessionId });
  }

  if (state === "checking" || state === "hidden") return null;

  if (state === "sent") {
    return (
      <Card className="flex flex-col gap-1 text-center">
        <p className="font-semibold">Check your email</p>
        <p className="text-sm text-ink-soft">
          Tap the link we sent to {email.trim()} to finish. Then choose a password, and this table will be in your account.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <p className="font-semibold">Save this bill and your history</p>
        <p className="text-sm text-ink-soft">
          Create a free account to keep this table, see what you&apos;ve paid, and start your own tables. It takes a few seconds.
        </p>
      </div>
      {state === "ask" ? (
        <div className="flex flex-col gap-2">
          <Button onClick={google} disabled={busy}>
            {busy ? "Opening Google…" : "Continue with Google"}
          </Button>
          <Button variant="secondary" onClick={() => setState("email")} disabled={busy}>
            Use email
          </Button>
        </div>
      ) : (
        <form onSubmit={saveEmail} className="flex flex-col gap-2">
          <Label htmlFor="save-account-email">Your email</Label>
          <Input
            id="save-account-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send me a link"}
          </Button>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="ghost" className="min-h-10 self-center text-sm" onClick={notNow}>
        Not now
      </Button>
    </Card>
  );
}
