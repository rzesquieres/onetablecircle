"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { AdminGate } from "../admin-gate";

interface Stats {
  users_registered: number;
  users_guest: number;
  active_7d: number;
  active_30d: number;
  tables_7d: number;
  tables_30d: number;
  bills_sent_30d: number;
  weekly: { week: string; tables: number; people: number }[];
  top_stores: { store_id: string; name: string; branch: string; tables: number }[];
  free_text_tables_90d: number;
  stores_published: number;
  ai_imports_30d: number;
  open_reports: number;
}

export function Analytics() {
  return (
    <AdminGate>
      <Dashboard />
    </AdminGate>
  );
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getSupabase()
      .rpc("admin_stats")
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error));
        else setStats(data as Stats);
      });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-soft">← Admin</Link>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-ink-soft">Counts only. No personal details are shown.</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!stats && !error && <Spinner />}
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Active users (7 days)" value={stats.active_7d} sub={`${stats.active_30d} in 30 days`} />
            <Tile label="Tables (7 days)" value={stats.tables_7d} sub={`${stats.tables_30d} in 30 days`} />
            <Tile label="Accounts" value={stats.users_registered} sub={`+ ${stats.users_guest} guests`} />
            <Tile label="Bills sent (30 days)" value={stats.bills_sent_30d} />
            <Tile label="Published stores" value={stats.stores_published} />
            <Tile label="AI imports (30 days)" value={stats.ai_imports_30d} />
            <Tile label="Open reports" value={stats.open_reports} href={stats.open_reports ? "/admin/reports" : undefined} />
            <Tile label="Free-text tables (90 days)" value={stats.free_text_tables_90d} sub="no store picked" />
          </div>
          <WeeklyChart weekly={stats.weekly} />
          <TopStores stores={stats.top_stores} />
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, href }: { label: string; value: number; sub?: string; href?: string }) {
  const body = (
    <Card className="flex h-full flex-col gap-1 py-3">
      <span className="text-xs text-ink-soft">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value.toLocaleString("en-PH")}</span>
      {sub && <span className="text-xs text-ink-soft">{sub}</span>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Tables started per week: one series, one hue, thin rounded columns, hover for exact values. */
function WeeklyChart({ weekly }: { weekly: Stats["weekly"] }) {
  const max = Math.max(1, ...weekly.map((w) => w.tables));
  const last = weekly[weekly.length - 1];
  const peak = weekly.reduce((a, b) => (b.tables > a.tables ? b : a), weekly[0]);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Tables per week</h2>
        <span className="text-sm text-ink-soft">last 12 weeks</span>
      </div>
      <Card>
        <div className="flex h-40 items-end gap-[2px] border-b border-line" role="img" aria-label="Tables started per week over the last 12 weeks">
          {weekly.map((w) => {
            const labelled = w === last || (w === peak && w.tables > 0);
            return (
              <div key={w.week} className="group relative flex h-full flex-1 items-end justify-center">
                {/* Hit area is the whole column, wider than the bar. */}
                <div
                  className="w-full max-w-6 rounded-t bg-chart"
                  style={{ height: `${(w.tables / max) * 100}%`, minHeight: w.tables ? 2 : 0 }}
                />
                {labelled && (
                  <span className="absolute -top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-0.5 text-[11px] font-medium text-ink-soft tabular-nums group-hover:hidden">
                    {w.tables}
                  </span>
                )}
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink shadow-sm group-hover:block"
                >
                  Week of {shortDate(w.week)}: <span className="font-semibold">{w.tables}</span> tables · {w.people} people
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-ink-soft">
          <span>{shortDate(weekly[0].week)}</span>
          <span>{shortDate(last.week)}</span>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-soft">Show as a table</summary>
          <table className="mt-2 w-full text-left">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="py-1 font-medium">Week of</th>
                <th className="py-1 text-right font-medium">Tables</th>
                <th className="py-1 text-right font-medium">People</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {weekly.map((w) => (
                <tr key={w.week} className="border-t border-line">
                  <td className="py-1">{shortDate(w.week)}</td>
                  <td className="py-1 text-right">{w.tables}</td>
                  <td className="py-1 text-right">{w.people}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>
    </section>
  );
}

/** Most-used stores: ranked horizontal bars, values in text color beside the bar. */
function TopStores({ stores }: { stores: Stats["top_stores"] }) {
  const max = Math.max(1, ...stores.map((s) => s.tables));
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Most-used stores</h2>
        <span className="text-sm text-ink-soft">tables, last 90 days</span>
      </div>
      <Card>
        {stores.length === 0 ? (
          <p className="text-sm text-ink-soft">No tables at listed stores yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {stores.map((s, i) => (
              <li key={s.store_id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <Link href={`/admin/stores/${s.store_id}`} className="min-w-0 truncate">
                    <span className="text-ink-soft">{i + 1}.</span> {s.name}
                    {s.branch && <span className="text-ink-soft"> · {s.branch}</span>}
                  </Link>
                  <span className="shrink-0 font-semibold tabular-nums">{s.tables}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-r bg-muted">
                  <div className="h-full rounded-r bg-chart" style={{ width: `${(s.tables / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}
