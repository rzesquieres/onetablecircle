"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Chip, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { AdminGate } from "../admin-gate";

interface Report {
  id: string;
  store_id: string;
  menu_item_id: string | null;
  kind: "wrong_price" | "wrong_item" | "unavailable" | "other";
  note: string;
  status: "open" | "resolved";
  created_at: string;
  stores: { name: string; branch: string } | null;
  menu_items: { name: string } | null;
}

export const REPORT_KIND_TEXT: Record<Report["kind"], string> = {
  wrong_price: "Wrong price",
  wrong_item: "Wrong name or details",
  unavailable: "No longer sold",
  other: "Other",
};

async function fetchReports(status: "open" | "resolved") {
  const { data, error } = await getSupabase()
    .from("menu_reports")
    .select("*, stores(name, branch), menu_items(name)")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);
  return { data: (data as unknown as Report[]) ?? [], error };
}

export function ReportsList() {
  return (
    <AdminGate>
      <List />
    </AdminGate>
  );
}

function List() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await fetchReports(status);
    if (error) setError(friendlyError(error));
    setReports(data);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    fetchReports(status).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(friendlyError(error));
      setReports(data);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function setReportStatus(id: string, next: "open" | "resolved") {
    setError("");
    const { error } = await getSupabase()
      .from("menu_reports")
      .update(next === "resolved" ? { status: next, resolved_at: new Date().toISOString() } : { status: next, resolved_at: null })
      .eq("id", id);
    if (error) setError(friendlyError(error));
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-soft">← Admin</Link>
        <h1 className="text-2xl font-semibold">Problem reports</h1>
        <p className="text-sm text-ink-soft">People at tables flag menu items that look wrong. Fix the menu, then mark the report resolved.</p>
      </div>
      <div className="flex gap-2">
        <Chip selected={status === "open"} onClick={() => setStatus("open")}>Open</Chip>
        <Chip selected={status === "resolved"} onClick={() => setStatus("resolved")}>Resolved</Chip>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {reports === null ? (
        <Spinner />
      ) : reports.length === 0 ? (
        <p className="text-ink-soft">No {status} reports.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {REPORT_KIND_TEXT[r.kind]}
                    {r.menu_items ? `: ${r.menu_items.name}` : ""}
                  </p>
                  <span className="text-xs text-ink-soft">{new Date(r.created_at).toLocaleString("en-PH")}</span>
                </div>
                <p className="text-sm text-ink-soft">
                  {r.stores ? [r.stores.name, r.stores.branch].filter(Boolean).join(" · ") : "Store deleted"}
                </p>
                {r.note && <p className="rounded-xl bg-muted px-3 py-2 text-sm">&ldquo;{r.note}&rdquo;</p>}
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/stores/${r.store_id}`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-medium">
                    Open store
                  </Link>
                  {r.status === "open" ? (
                    <Button className="min-h-11 text-sm" onClick={() => setReportStatus(r.id, "resolved")}>Mark resolved</Button>
                  ) : (
                    <Button variant="ghost" className="min-h-11 text-sm" onClick={() => setReportStatus(r.id, "open")}>Reopen</Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
