"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import type { Store } from "@/lib/types";
import { AdminGate, STATUS_STYLE } from "./admin-gate";
import { AiAddStoreCard, RecentImports } from "./ai-import";

/** "3 open problem reports" banner, shown only when there are some. */
function OpenReportsLink() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    getSupabase()
      .from("menu_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .then(({ count }) => setCount(count ?? 0));
  }, []);
  if (!count) return null;
  return (
    <Link href="/admin/reports">
      <Notice tone="warn">
        {count} open problem report{count === 1 ? "" : "s"} from users. Review them →
      </Notice>
    </Link>
  );
}

export function AdminHome() {
  return (
    <AdminGate>
      <StoreList />
    </AdminGate>
  );
}

function StoreList() {
  const router = useRouter();
  const [stores, setStores] = useState<Store[] | null>(null);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSupabase()
      .from("stores")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error));
        setStores((data as Store[]) ?? []);
      });
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await getSupabase()
      .from("stores")
      .insert({ name: name.trim(), branch: branch.trim() })
      .select("id")
      .single();
    if (error) {
      setError(friendlyError(error));
      setBusy(false);
      return;
    }
    router.push(`/admin/stores/${data.id}`);
  }

  const shown = (stores ?? []).filter((s) =>
    `${s.name} ${s.branch}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stores & menus</h1>
        <span className="flex items-center gap-3">
          <Link href="/admin/analytics" className="text-sm font-medium text-brand">Analytics</Link>
          <Link href="/admin/reports" className="text-sm text-ink-soft">Reports</Link>
          <Link href="/" className="text-sm text-ink-soft">Home</Link>
        </span>
      </div>

      <OpenReportsLink />
      <AiAddStoreCard />
      <RecentImports />

      <Card>
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="sname">New store</Label>
            <Input id="sname" required maxLength={80} placeholder="e.g. Starbucks" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label htmlFor="sbranch">Branch (optional)</Label>
            <Input id="sbranch" maxLength={80} placeholder="e.g. BGC High Street" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
        </form>
        <p className="mt-2 text-xs text-ink-soft">New stores start as drafts. Customers only see stores you publish.</p>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      <section className="flex flex-col gap-2">
        <Input aria-label="Filter stores" placeholder="Filter stores…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {stores === null ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <p className="text-ink-soft">No stores yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/stores/${s.id}`}>
                  <Card className="flex items-center justify-between gap-3 py-3 active:bg-muted">
                    <span>
                      <span className="block font-medium">{s.name}</span>
                      <span className="text-sm text-ink-soft">
                        {s.branch || "All branches"} · menu updated {new Date(s.menu_updated_at).toLocaleDateString("en-PH")}
                      </span>
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[s.status]}`}>
                      {s.status}
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
