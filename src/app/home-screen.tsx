"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Notice, Spinner } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { useUser } from "@/lib/use-user";
import type { Session } from "@/lib/types";

interface MyShare {
  total: number;
  paid: boolean;
  isHost: boolean;
}

/** Your bill share per table: session id -> share. */
async function loadHistory(userId: string): Promise<Map<string, MyShare>> {
  const supabase = getSupabase();
  const { data: mine } = await supabase.from("participants").select("id, session_id, is_host").eq("user_id", userId);
  const parts = mine ?? [];
  if (!parts.length) return new Map();
  const ids = parts.map((p) => p.id as string);
  const [{ data: shares }, { data: payments }] = await Promise.all([
    supabase.from("bill_shares").select("session_id, participant_id, total_centavos").in("participant_id", ids),
    supabase.from("payments").select("participant_id, confirmed_at, marked_paid_at").in("participant_id", ids),
  ]);
  const out = new Map<string, MyShare>();
  for (const s of shares ?? []) {
    const part = parts.find((p) => p.id === s.participant_id);
    const pay = (payments ?? []).find((p) => p.participant_id === s.participant_id);
    out.set(s.session_id as string, {
      total: Number(s.total_centavos),
      paid: Boolean(pay?.confirmed_at || pay?.marked_paid_at),
      isHost: Boolean(part?.is_host),
    });
  }
  return out;
}

const HOW_IT_WORKS = [
  { title: "Start a table", text: "The host picks the restaurant and opens a table." },
  { title: "Share the code", text: "Friends scan the QR code or tap the link and join with just their name." },
  { title: "Order and split", text: "Everyone adds their own orders. The app works out each person's share." },
];

function HowItWorks() {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">How it works</h2>
      <ol className="flex flex-col gap-3">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white">
              {i + 1}
            </span>
            <span>
              <span className="block font-medium">{step.title}</span>
              <span className="text-sm text-ink-soft">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

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

  const [history, setHistory] = useState<Map<string, MyShare>>(new Map());

  useEffect(() => {
    if (!user) return;
    const supabase = getSupabase();
    supabase
      .from("sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error));
        setSessions((data as Session[]) ?? []);
      });
    // Your share and payment status at each table (history).
    void loadHistory(user.id).then(setHistory);
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

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const monthTotal = (sessions ?? [])
    .filter((s) => s.created_at >= monthStart)
    .reduce((sum, s) => sum + (history.get(s.id)?.total ?? 0), 0);

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
          <li>• See exactly what you owe, VAT and service charge included</li>
        </ul>
        <Link href="/login" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white">
          Sign in to start
        </Link>
        <div>
          <p className="mb-2 text-sm text-ink-soft">Got a table code from a friend? No account needed.</p>
          {joinForm}
        </div>
        <HowItWorks />
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
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Your tables</h2>
          {monthTotal > 0 && (
            <span className="text-sm text-ink-soft">
              This month: <span className="font-semibold text-ink">{formatMoney(monthTotal)}</span>
            </span>
          )}
        </div>
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
                    <span className="shrink-0 text-right text-sm">
                      {history.get(s.id) ? (
                        <>
                          <span className="block font-semibold tabular-nums">{formatMoney(history.get(s.id)!.total)}</span>
                          <span className="text-xs text-ink-soft">
                            {history.get(s.id)!.isHost
                              ? "your share"
                              : history.get(s.id)!.total === 0
                                ? "nothing to pay"
                                : history.get(s.id)!.paid
                                  ? "paid ✓"
                                  : "to pay"}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-soft">{STATUS_LABEL[s.status]}</span>
                      )}
                    </span>
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
