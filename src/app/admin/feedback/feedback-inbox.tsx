"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Chip, Notice, Spinner } from "@/components/ui";
import {
  FEEDBACK_CATEGORY_TEXT,
  describeDevice,
  type FeedbackCategory,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/lib/feedback";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { AdminGate } from "../admin-gate";

interface FeedbackRow {
  id: string;
  created_at: string;
  user_id: string | null;
  sender_name: string;
  sender_is_guest: boolean;
  contact_email: string | null;
  kind: FeedbackKind;
  category: FeedbackCategory | null;
  rating: number | null;
  message: string;
  page_path: string;
  session_id: string | null;
  table_title: string;
  user_agent: string;
  status: FeedbackStatus;
}

type CategoryFilter = "all" | FeedbackCategory;

const STATUS_TABS: { value: FeedbackStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "done", label: "Done" },
];

const CATEGORY_STYLE: Record<FeedbackCategory, string> = {
  bug: "bg-danger/10 text-danger",
  idea: "bg-ok/15 text-ok",
  other: "bg-muted text-ink-soft",
};

async function fetchFeedback(status: FeedbackStatus, category: CategoryFilter) {
  let q = getSupabase().from("feedback").select("*").eq("status", status);
  if (category !== "all") q = q.eq("category", category);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  return { data: (data as FeedbackRow[]) ?? [], error };
}

export function FeedbackInbox() {
  return (
    <AdminGate>
      <Inbox />
    </AdminGate>
  );
}

function Inbox() {
  const [status, setStatus] = useState<FeedbackStatus>("new");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await fetchFeedback(status, category);
    if (error) setError(friendlyError(error));
    setRows(data);
  }, [status, category]);

  useEffect(() => {
    let cancelled = false;
    fetchFeedback(status, category).then(({ data, error }) => {
      if (cancelled) return;
      setError(error ? friendlyError(error) : "");
      setRows(data);
    });
    return () => {
      cancelled = true;
    };
  }, [status, category]);

  async function move(id: string, next: FeedbackStatus) {
    setError("");
    const { error } = await getSupabase().from("feedback").update({ status: next }).eq("id", id);
    if (error) setError(friendlyError(error));
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-soft">← Admin</Link>
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-sm text-ink-soft">
          What people sent from the Send feedback page. Mark items read once you&apos;ve seen them, and done once
          they&apos;re handled.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => (
            <Chip key={t.value} selected={status === t.value} onClick={() => { setRows(null); setStatus(t.value); }}>
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "bug", "idea", "other"] as CategoryFilter[]).map((c) => (
            <Chip
              key={c}
              selected={category === c}
              className="min-h-9 px-3 text-xs"
              onClick={() => { setRows(null); setCategory(c); }}
            >
              {c === "all" ? "All types" : FEEDBACK_CATEGORY_TEXT[c]}
            </Chip>
          ))}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-ink-soft">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <FeedbackCard row={r} onMove={move} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackCard({ row: r, onMove }: { row: FeedbackRow; onMove: (id: string, next: FeedbackStatus) => void }) {
  const who = r.sender_name || (r.sender_is_guest ? "Guest" : "Someone");
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          {r.category && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CATEGORY_STYLE[r.category]}`}>
              {FEEDBACK_CATEGORY_TEXT[r.category]}
            </span>
          )}
          {r.rating !== null && <span className="text-sm" aria-label={`${r.rating} of 5 stars`}>{"★".repeat(r.rating)}</span>}
          <span className="font-semibold">{who}</span>
          {r.sender_is_guest && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink-soft">guest</span>}
        </span>
        <span className="text-xs text-ink-soft">{new Date(r.created_at).toLocaleString("en-PH")}</span>
      </div>

      {r.message && <p className="whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm">{r.message}</p>}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-ink-soft">
        {r.table_title && (
          <>
            <dt>Table</dt>
            <dd className="text-ink">{r.table_title}</dd>
          </>
        )}
        <dt>Page</dt>
        <dd className="break-all">{r.page_path || "—"}</dd>
        <dt>Device</dt>
        <dd>{describeDevice(r.user_agent)}</dd>
        <dt>Reply to</dt>
        <dd>
          {r.contact_email ? (
            <a
              href={`mailto:${r.contact_email}?subject=${encodeURIComponent("Your OneTableCircle feedback")}`}
              className="text-brand underline"
            >
              {r.contact_email}
            </a>
          ) : (
            "Didn't ask for a reply"
          )}
        </dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        {r.status === "new" && (
          <Button variant="secondary" className="min-h-11 text-sm" onClick={() => onMove(r.id, "read")}>Mark read</Button>
        )}
        {r.status !== "done" ? (
          <Button className="min-h-11 text-sm" onClick={() => onMove(r.id, "done")}>Mark done</Button>
        ) : (
          <Button variant="ghost" className="min-h-11 text-sm" onClick={() => onMove(r.id, "new")}>Move back to new</Button>
        )}
      </div>
    </Card>
  );
}
