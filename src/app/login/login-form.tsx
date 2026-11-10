"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label, Notice } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { googleSignInEnabled, supabaseConfigured } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/site";

type Mode = "signin" | "signup";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  // `?mode=signup` (e.g. from the testers' QR code) opens on "Create an account".
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") ?? "");
  const [info, setInfo] = useState("");

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
    setInfo("");
    const supabase = getSupabase();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
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
          setInfo("Check your email for a confirmation link, then come back here.");
        }
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
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
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {info && <Notice>{info}</Notice>}
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
          setInfo("");
        }}
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
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
