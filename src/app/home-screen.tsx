"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { useUser } from "@/lib/use-user";
import type { Session } from "@/lib/types";

const STATUS_LABEL: Record<Session["status"], string> = {
  open: "Ordering",
  closed: "Ordering closed",
  billing: "Splitting bill",
  settled: "Settled",
};

export function HomeScreen() {
  const router = useRouter();
  const { user, isGuest, isAdmin, displayName, loading } = useUser();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    getSupabase()
      .from("sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error));
        setSessions((data as Session[]) ?? []);
      });
  }, [user]);

  function join(e: FormEvent) {
    e.preventDefault();
    const c = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (c) router.push(`/j/${c}`);
  }

  if (!supabaseConfigured) {
    return (
      <div className="mt-8">
        <Notice tone="warn">Almost ready: the app still needs its Supabase keys. See docs/SETUP-SUPABASE.md.</Notice>
      </div>
    );
  }
  if (loading) return <Spinner />;

  const joinForm = (
    <form onSubmit={join} className="flex gap-2">
      <Input
        aria-label="Table code"
        placeholder="Table code"
        autoCapitalize="characters"
        autoComplete="off"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="font-mono uppercase tracking-widest"
      />
      <Button type="submit" variant="secondary">Join</Button>
    </form>
  );

  if (!user) {
    return (
      <div className="mt-8 flex flex-col gap-6">
        <ul className="flex flex-col gap-2 text-ink-soft">
          <li>• Everyone orders from their own phone</li>
          <li>• One clean list for the waiter</li>
          <li>• Tick items off as they arrive</li>
        </ul>
        <Link href="/login" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white">
          Sign in to start
        </Link>
        <div>
          <p className="mb-2 text-sm text-ink-soft">Got a table code from a friend?</p>
          {joinForm}
        </div>
      </div>
    );
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p>
          Hi, <span className="font-semibold">{displayName}</span>
        </p>
        <span className="flex items-center gap-1">
          {isAdmin && (
            <Link href="/admin" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-brand">
              Admin
            </Link>
          )}
          <Link href="/profile" className="inline-flex min-h-11 items-center px-2 text-sm text-ink-soft">
            Profile
          </Link>
          {!isGuest && (
            <button onClick={signOut} className="min-h-11 px-2 text-sm text-ink-soft">Sign out</button>
          )}
        </span>
      </div>

      {isGuest ? (
        <Notice>
          You joined as a guest, so your tables are saved on this phone only.{" "}
          <Link href="/login" className="font-medium text-brand">Sign in or create an account</Link> to host your own
          table.
        </Notice>
      ) : (
        <Link href="/s/new" className="inline-flex min-h-14 items-center justify-center rounded-xl bg-brand px-4 text-lg font-semibold text-white active:bg-brand-strong">
          Start a table
        </Link>
      )}
      {joinForm}

      {error && <Notice tone="error">{error}</Notice>}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">Your tables</h2>
        {sessions === null ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <p className="text-ink-soft">No tables yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/s/${s.id}`}>
                  <Card className="flex items-center justify-between active:bg-muted">
                    <span>
                      <span className="block font-medium">{s.title}</span>
                      <span className="text-sm text-ink-soft">
                        {new Date(s.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                        {s.host_id === user.id ? " · You're host" : ""}
                      </span>
                    </span>
                    <span className="text-sm text-ink-soft">{STATUS_LABEL[s.status]}</span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
