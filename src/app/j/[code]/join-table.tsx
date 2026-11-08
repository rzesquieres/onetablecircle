"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { useUser } from "@/lib/use-user";

interface Preview {
  title: string;
  host_name: string | null;
  status: "open" | "closed" | "billing" | "settled";
  people: number;
}

type LoadState = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; preview: Preview };

function finishedStatus(load: LoadState): boolean {
  return load.kind === "ready" && (load.preview.status === "billing" || load.preview.status === "settled");
}

export function JoinTable() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { user, isGuest, displayName, loading: userLoading } = useUser();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Look up the table (works without signing in).
  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    getSupabase()
      .rpc("table_preview", { p_code: code })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(friendlyError(error));
          setLoad({ kind: "missing" });
        } else {
          const row = (data as Preview[] | null)?.[0];
          setLoad(row ? { kind: "ready", preview: row } : { kind: "missing" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const shownName = nameTouched ? name : name || (displayName === "Guest" ? "" : displayName);

  async function join(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const supabase = getSupabase();
      const trimmed = shownName.trim();
      if (!user) {
        if (!trimmed) throw new Error("Please type your name so others know whose order is whose.");
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      const { data, error } = await supabase.rpc("join_session", { p_code: code, p_display_name: trimmed || null });
      if (error) throw error;
      router.replace(`/s/${data}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  // People with a real account join straight away, like before.
  const canAutoJoin = Boolean(!userLoading && user && !isGuest && load.kind === "ready" && !finishedStatus(load));
  useEffect(() => {
    if (!canAutoJoin) return;
    let cancelled = false;
    getSupabase()
      .rpc("join_session", { p_code: code, p_display_name: null })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(friendlyError(error));
        else router.replace(`/s/${data}`);
      });
    return () => {
      cancelled = true;
    };
  }, [canAutoJoin, code, router]);

  if (!supabaseConfigured) return <Notice tone="warn">The app isn&apos;t fully set up yet.</Notice>;
  if (load.kind === "loading" || userLoading) return <Spinner label="Finding the table…" />;
  if (load.kind === "missing") {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="error">{error || "We couldn't find that table. Check the code or ask the host for a new link."}</Notice>
        <Link href="/" className="text-brand">Go to home</Link>
      </div>
    );
  }

  const { preview } = load;
  const finished = preview.status === "billing" || preview.status === "settled";
  const loginHref = `/login?next=${encodeURIComponent(`/j/${code}`)}`;

  if (canAutoJoin && !error) return <Spinner label="Joining table…" />;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <p className="text-sm text-ink-soft">You&apos;re invited to</p>
        <h1 className="text-2xl font-semibold">{preview.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {preview.host_name ? `Hosted by ${preview.host_name}` : "Shared table"} · {preview.people}{" "}
          {preview.people === 1 ? "person" : "people"} so far
        </p>
      </Card>

      {finished ? (
        <Notice tone="warn">This table has finished and isn&apos;t taking new people.</Notice>
      ) : (
        <form onSubmit={join} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              autoComplete="given-name"
              maxLength={40}
              required={!user}
              placeholder="e.g. Ana"
              value={shownName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
            />
            <p className="mt-1 text-xs text-ink-soft">This is how others at the table will see you.</p>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy} className="min-h-14 text-lg">
            {busy ? "Joining…" : user ? "Join table" : "Join as guest"}
          </Button>
          {!user && (
            <p className="text-center text-sm text-ink-soft">
              No account needed.{" "}
              <Link href={loginHref} className="font-medium text-brand">
                Sign in instead
              </Link>{" "}
              to keep your history.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
