"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Notice, Spinner } from "@/components/ui";
import { consolidate, progress } from "@/lib/consolidate";
import { feedbackHref } from "@/lib/feedback";
import { acceptsOrders } from "@/lib/session-rules";
import { useMenu } from "@/lib/use-menu";
import { useTable } from "./use-table";
import { OrderTab } from "./order-tab";
import { WaiterTab } from "./waiter-tab";
import { MineTab } from "./mine-tab";
import { PeopleTab } from "./people-tab";
import { BillTab } from "./bill/bill-tab";

type Tab = "order" | "waiter" | "mine" | "bill" | "people";

export function TableScreen() {
  const { id } = useParams<{ id: string }>();
  const { data, error, me, isHost, reload } = useTable(id);
  const { menu } = useMenu(data?.session.store_id ?? null);
  const [tab, setTab] = useState<Tab>("order");
  const [now, setNow] = useState(() => new Date());

  // Re-render every 20s so the cutoff takes effect on screen without a reload.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  const lines = useMemo(
    () => (data ? consolidate(data.items, data.assignees, data.events) : []),
    [data],
  );

  if (error && !data) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
        <Notice tone="error">{error}</Notice>
        <Link href="/" className="text-brand">Back to home</Link>
      </main>
    );
  }
  if (!data) return <Spinner label="Loading table…" />;

  const { session } = data;
  const open = acceptsOrders(session, now);
  const prog = progress(lines);
  const pct = prog.total ? Math.round((prog.served / prog.total) * 100) : 0;
  const ctx = { data, me, isHost, lines, now, reload, ordersOpen: open, menu };
  const storeLine = menu ? [menu.store.name, menu.store.branch].filter(Boolean).join(" · ") : "";
  // A dot on the Bill tab when you have a bill to pay that you haven't marked paid.
  const myShare = me ? data.shares.find((s) => s.participant_id === me.id) : undefined;
  const billWaiting = Boolean(
    me && !me.is_host && myShare && myShare.total_centavos > 0 && !data.payments.some((p) => p.participant_id === me.id),
  );

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-background/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="flex items-center gap-3 text-sm text-ink-soft">
              <Link href="/">← Tables</Link>
              <Link href={feedbackHref(`/s/${session.id}`, session.id)} className="underline">Feedback</Link>
            </span>
            <h1 className="truncate text-xl font-semibold">{session.title}</h1>
            {storeLine && storeLine !== session.title && <p className="truncate text-sm text-ink-soft">at {storeLine}</p>}
          </div>
          <StatusBadge open={open} status={session.status} cutoff={session.order_cutoff_at} />
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-sm">
            <span className="font-medium">
              {prog.served} of {prog.total} item{prog.total === 1 ? "" : "s"} served
            </span>
            <span className="text-ink-soft">{pct}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        {!me ? (
          <Notice tone="warn">You&apos;re viewing this table but haven&apos;t joined it.</Notice>
        ) : tab === "order" ? (
          <OrderTab {...ctx} me={me} />
        ) : tab === "waiter" ? (
          <WaiterTab {...ctx} me={me} />
        ) : tab === "mine" ? (
          <MineTab {...ctx} me={me} />
        ) : tab === "bill" ? (
          <BillTab {...ctx} me={me} />
        ) : (
          <PeopleTab {...ctx} me={me} />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-md grid-cols-5">
          <TabButton active={tab === "order"} onClick={() => setTab("order")} label="Order" icon="＋" />
          <TabButton active={tab === "waiter"} onClick={() => setTab("waiter")} label="Waiter" icon="☰" badge={prog.total - prog.served || undefined} />
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")} label="Mine" icon="●" />
          <TabButton
            active={tab === "bill"}
            onClick={() => setTab("bill")}
            label="Bill"
            icon="₱"
            badge={billWaiting ? 1 : undefined}
          />
          <TabButton active={tab === "people"} onClick={() => setTab("people")} label={isHost ? "Host" : "People"} icon="⚇" />
        </div>
      </nav>
    </div>
  );
}

function StatusBadge({ open, status, cutoff }: { open: boolean; status: string; cutoff: string | null }) {
  if (open) {
    return (
      <span className="shrink-0 rounded-full bg-ok/15 px-3 py-1 text-xs font-semibold text-ok">
        {cutoff ? `Orders until ${new Date(cutoff).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : "Ordering open"}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink-soft">
      {status === "open" || status === "closed" ? "Ordering closed" : status === "billing" ? "Splitting bill" : "Settled"}
    </span>
  );
}

function TabButton({ active, onClick, label, icon, badge }: { active: boolean; onClick: () => void; label: string; icon: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${active ? "text-brand" : "text-ink-soft"}`}
    >
      <span aria-hidden className="text-lg leading-none">{icon}</span>
      {label}
      {badge ? (
        <span className="absolute right-[18%] top-2 min-w-5 rounded-full bg-warn px-1.5 text-[11px] font-bold leading-5 text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
