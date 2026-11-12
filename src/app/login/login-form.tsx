"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label, Notice } from "@/components/ui";
import { isEmailNotConfirmed, isEmailRateLimited, RESEND_COOLDOWN_SECONDS } from "@/lib/auth-errors";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { googleSignInEnabled, supabaseConfigured } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/site";

type Mode = "signin" | "signup" | "forgot";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  // `?mode=signup` (e.g. from the testers' QR code) opens on "Create an account";
  // `?mode=forgot` (e.g. from the "account restored" email) opens on "Forgot password".
  const initialMode = params.get("mode");
  const [mode, setMode] = useState<Mode>(
    initialMode === "signup" ? "signup" : initialMode === "forgot" ? "forgot" : "signin",
  );
  const [resetSent, setResetSent] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") ?? "");
  // Set when the email still needs confirming: after sign-up, or a sign-in before confirming.
  const [pending, setPending] = useState<{ email: string; reason: "signup" | "signin" } | null>(null);

  if (!supabaseConfigured) {
    return (
      <div className="mt-6">
        <Notice tone="warn">Sign-in isn&apos;t set up yet: the Supabase keys are missing.</Notice>
      </div>
    );
  }

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setBusy(true);
    setError("");
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) {
      setError(friendlyError(error));
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = getSupabase();
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
        });
        if (error) throw error;
        setResetSent(email.trim());
        return;
      }
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error && isEmailNotConfirmed(error)) {
          setPending({ email: email.trim(), reason: "signin" });
          return;
        }
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: callbackUrl() },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setPending({ email: email.trim(), reason: "signup" });
        }
      }
    } catch (err) {
      setError(
        isEmailRateLimited(err)
          ? "We've sent a lot of emails just now. Please wait a few minutes and try again."
          : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <CheckEmail
        email={pending.email}
        reason={pending.reason}
        redirectTo={callbackUrl()}
        onBack={() => {
          setPending(null);
          setMode("signin");
          setPassword("");
        }}
      />
    );
  }

  if (mode === "forgot") {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Forgot password</h2>
        {resetSent ? (
          <>
            <p>
              If <span className="font-semibold break-all">{resetSent}</span> has an account, we sent it a link to set a
              new password. It can take a minute to arrive; check your spam folder too.
            </p>
            {googleSignInEnabled && (
              <p className="text-sm text-ink-soft">Used Google before? You can also go back and choose Continue with Google.</p>
            )}
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-ink-soft">Type your email and we&apos;ll send you a link to set a new password.</p>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
          </form>
        )}
        <button
          type="button"
          className="min-h-11 text-sm font-medium text-brand"
          onClick={() => {
            setMode("signin");
            setResetSent("");
            setError("");
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      {googleSignInEnabled && (
        <>
          <Button variant="secondary" onClick={google} disabled={busy}>
            <GoogleIcon /> Continue with Google
          </Button>

          <div className="flex items-center gap-3 text-sm text-ink-soft">
            <span className="h-px flex-1 bg-line" /> or use email <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === "signup" && (
          <div>
            <Label htmlFor="name">Your name</Label>
            <Input id="name" autoComplete="name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signin" && (
            <button
              type="button"
              className="mt-1 text-sm text-ink-soft underline"
              onClick={() => {
                setMode("forgot");
                setError("");
              }}
            >
              Forgot password?
            </button>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        className="min-h-11 text-sm font-medium text-brand"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError("");
              }}
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

/** "Check your email" screen with a Resend button (cooldown so it can't be spammed). */
function CheckEmail({
  email,
  reason,
  redirectTo,
  onBack,
}: {
  email: string;
  reason: "signup" | "signin";
  redirectTo: string;
  onBack: () => void;
}) {
  // Sign-up just sent an email, so start on cooldown; a sign-in attempt may not have.
  const [wait, setWait] = useState(reason === "signup" ? RESEND_COOLDOWN_SECONDS : 0);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function resend() {
    setSending(true);
    setMessage(null);
    const { error } = await getSupabase().auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
    setSending(false);
    if (error) {
      setMessage({
        tone: "error",
        text: isEmailRateLimited(error)
          ? "Please wait a minute before asking for another email."
          : friendlyError(error),
      });
      if (isEmailRateLimited(error)) setWait(RESEND_COOLDOWN_SECONDS);
      return;
    }
    setMessage({ tone: "info", text: "Sent. It can take a minute to arrive." });
    setWait(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{reason === "signup" ? "Check your email" : "Please confirm your email first"}</h2>
      <p>
        We sent a confirmation link to <span className="font-semibold break-all">{email}</span>. Tap it to finish
        {reason === "signup" ? " creating your account" : " signing in"}.
      </p>
      <p className="text-sm text-ink-soft">
        Can&apos;t find it? Check your spam or promotions folder. The link opens OneTableCircle and signs you in.
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Button variant="secondary" onClick={resend} disabled={sending || wait > 0}>
        {sending ? "Sending…" : wait > 0 ? `Resend email (${wait}s)` : "Resend email"}
      </Button>
      <button type="button" className="min-h-11 text-sm font-medium text-brand" onClick={onBack}>
        Wrong email? Go back
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
