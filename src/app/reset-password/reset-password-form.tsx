"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Notice } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/use-user";

/** Reached from the password-reset email (via /auth/callback, which signs them in). */
export function ResetPasswordForm() {
  const router = useRouter();
  const { user, loading } = useUser();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading) return null;
  if (!user || user.is_anonymous) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Notice tone="warn">That reset link has expired or was already used.</Notice>
        <Link href="/login?mode=forgot" className="text-sm font-medium text-brand">Send a new link</Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const { error } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        Signed in as <span className="break-all font-semibold">{user.email}</span>. Choose a new password.
      </p>
      <div>
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="confirm-password">Type it again</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</Button>
    </form>
  );
}
