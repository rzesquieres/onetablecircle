"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/use-user";

interface CircleRow {
  id: string;
  name: string;
  is_owner: boolean;
  tables: number;
}

/** OTC-34: your Circles (saved groups) and a way into each one's balances. */
export function CirclesList() {
  const { user, isGuest, loading } = useUser();
  const [rows, setRows] = useState<CircleRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || !user || isGuest) return;
    getSupabase()
      .rpc("my_circles")
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error));
        else setRows((data as CircleRow[]) ?? []);
      });
  }, [loading, user, isGuest]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/" className="text-sm text-ink-soft">← Home</Link>
        <h1 className="text-2xl font-semibold">Circles</h1>
        <p className="text-sm text-ink-soft">Who owes whom across your meals together.</p>
      </div>
      {loading ? (
        <Spinner />
      ) : !user || isGuest ? (
        <Notice>
          <Link href="/login?next=/circles" className="font-medium underline">Sign in with an account</Link> to keep balances with your
          groups.
        </Notice>
      ) : error ? (
        <Notice tone="error">{error}</Notice>
      ) : !rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Notice>
          No Circles yet. At any table, open the People tab and tap &quot;Save&quot; to keep that group. Tables you start with the
          group count towards its balances.
        </Notice>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/circles/${c.id}`}>
                <Card className="flex items-center justify-between gap-3 py-3 active:bg-muted">
                  <span>
                    <span className="block font-medium">{c.name}</span>
                    <span className="text-sm text-ink-soft">
                      {Number(c.tables)} {Number(c.tables) === 1 ? "meal" : "meals"}
                      {c.is_owner ? "" : " · shared with you"}
                    </span>
                  </span>
                  <span aria-hidden className="text-ink-soft">→</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
