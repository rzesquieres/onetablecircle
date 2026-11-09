"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Chip, Input, Label, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/use-user";

const CUTOFFS = [
  { label: "No cutoff", minutes: 0 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
];

export function NewTableForm() {
  const router = useRouter();
  const { isGuest, loading } = useUser();
  const [title, setTitle] = useState("");
  const [store, setStore] = useState<StoreHit | null>(null);
  const [serviceCharge, setServiceCharge] = useState("10");
  const [cutoffMinutes, setCutoffMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<{ id: string; name: string; count: number }[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || isGuest) return;
    getSupabase()
      .from("saved_groups")
      .select("id, name, saved_group_members(count)")
      .order("name")
      .then(({ data }) =>
        setGroups(
          (data ?? []).map((g) => ({
            id: g.id as string,
            name: g.name as string,
            count: (g.saved_group_members as unknown as { count: number }[])?.[0]?.count ?? 0,
          })),
        ),
      );
  }, [loading, isGuest]);

  function pickStore(s: StoreHit | null) {
    setStore(s);
    if (s) setServiceCharge(String(s.default_service_charge_bps / 100));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.push("/login?next=/s/new");
        return;
      }
      const pct = Number(serviceCharge || "0");
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Service charge must be between 0 and 100%.");
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          host_id: auth.user.id,
          title: title.trim() || (store ? [store.name, store.branch].filter(Boolean).join(" ") : "Our table"),
          store_id: store?.id ?? null,
          service_charge_bps: Math.round(pct * 100),
          order_cutoff_at: cutoffMinutes ? new Date(Date.now() + cutoffMinutes * 60_000).toISOString() : null,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (groupId) {
        // Not fatal if it fails: the table exists and people can still join by link.
        await supabase.rpc("add_saved_group_to_session", { p_session_id: data.id, p_group_id: groupId });
      }
      router.replace(`/s/${data.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (isGuest) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Notice>
          You&apos;re using OneTableCircle as a guest. To host your own table, sign in or create a free account. (Your
          guest tables stay on this phone until you sign out.)
        </Notice>
        <Link
          href="/login?next=/s/new"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white"
        >
          Sign in or create account
        </Link>
        <Link href="/" className="text-center text-sm text-ink-soft">Back</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
      <StorePicker value={store} onChange={pickStore} />

      {groups.length > 0 && (
        <div>
          <Label>Who&apos;s coming? (optional)</Label>
          <div className="flex flex-wrap gap-2">
            <Chip selected={groupId === null} onClick={() => setGroupId(null)}>Just share the link</Chip>
            {groups.map((g) => (
              <Chip key={g.id} selected={groupId === g.id} onClick={() => setGroupId(g.id)}>
                {g.name} ({g.count})
              </Chip>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-soft">A saved group is added to the table straight away; it shows up on their phones.</p>
        </div>
      )}

      <div>
        <Label htmlFor="title">Table name (optional)</Label>
        <Input
          id="title"
          placeholder={store ? [store.name, store.branch].filter(Boolean).join(" ") : "e.g. Friday lunch"}
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="sc">Service charge (%)</Label>
        <Input id="sc" inputMode="decimal" value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value)} className="max-w-28" />
      </div>

      <div>
        <Label>Close ordering after</Label>
        <div className="flex flex-wrap gap-2">
          {CUTOFFS.map((c) => (
            <Chip key={c.minutes} selected={cutoffMinutes === c.minutes} onClick={() => setCutoffMinutes(c.minutes)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-soft">You can change or close ordering any time.</p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy} className="min-h-14 text-lg">
        {busy ? "Creating…" : "Create table"}
      </Button>
      <Link href="/" className="text-center text-sm text-ink-soft">Cancel</Link>
    </form>
  );
}

interface StoreHit {
  id: string;
  name: string;
  branch: string;
  status: string;
  default_service_charge_bps: number;
}

/** Search published stores by name or branch; or skip and use free-text items. */
function StorePicker({ value, onChange }: { value: StoreHit | null; onChange: (s: StoreHit | null) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StoreHit[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.replace(/[%,()*\\]/g, " ").trim();
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      getSupabase()
        .from("stores")
        .select("id, name, branch, status, default_service_charge_bps")
        .neq("status", "archived")
        .or(`name.ilike.%${q}%,branch.ilike.%${q}%`)
        .order("name")
        .limit(8)
        .then(({ data }) => {
          if (cancelled) return;
          setHits((data as StoreHit[]) ?? []);
          setSearched(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  if (value) {
    return (
      <div>
        <Label>Store</Label>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand bg-surface p-3">
          <span>
            <span className="block font-semibold">{value.name}</span>
            {value.branch && <span className="text-sm text-ink-soft">{value.branch}</span>}
            {value.status === "draft" && <span className="text-sm text-warn"> · draft (admins only)</span>}
          </span>
          <Button type="button" variant="ghost" className="min-h-11 text-sm" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
        <p className="mt-1 text-xs text-ink-soft">Everyone orders from this store&apos;s menu, plus &quot;Other item&quot; for anything not listed.</p>
      </div>
    );
  }

  const showHits = query.trim().length >= 2;
  return (
    <div>
      <Label htmlFor="store">Store (optional)</Label>
      <Input
        id="store"
        autoComplete="off"
        placeholder="Search, e.g. Starbucks"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {showHits && hits.length > 0 && (
        <ul className="mt-2 flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
          {hits.map((s) => (
            <li key={s.id} className="border-b border-line last:border-0">
              <button type="button" className="flex min-h-12 w-full flex-col justify-center px-3 py-2 text-left active:bg-muted" onClick={() => onChange(s)}>
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-ink-soft">
                  {s.branch || "All branches"}
                  {s.status === "draft" ? " · draft" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-ink-soft">
        {showHits && searched && hits.length === 0
          ? "Not listed yet. That's fine: just continue and everyone types their items."
          : "Not listed? Skip this and everyone types their items."}
      </p>
    </div>
  );
}
