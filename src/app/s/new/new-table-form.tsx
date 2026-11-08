"use client";

import { useState, type FormEvent } from "react";
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
  const [serviceCharge, setServiceCharge] = useState("10");
  const [cutoffMinutes, setCutoffMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
          title: title.trim() || "Our table",
          service_charge_bps: Math.round(pct * 100),
          order_cutoff_at: cutoffMinutes ? new Date(Date.now() + cutoffMinutes * 60_000).toISOString() : null,
        })
        .select("id")
        .single();
      if (error) throw error;
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
      <div>
        <Label htmlFor="title">Where are you eating?</Label>
        <Input id="title" placeholder="e.g. Starbucks BGC, Friday lunch" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        <p className="mt-1 text-xs text-ink-soft">Picking a store from a menu comes in a later phase. For now, everyone types their items.</p>
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
