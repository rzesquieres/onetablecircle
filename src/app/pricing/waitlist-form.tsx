"use client";

import { useState, type FormEvent } from "react";
import { Button, Chip, Input, Label, Notice } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";

type Plan = "monthly" | "yearly" | "undecided";

const PLANS: { value: Plan; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "undecided", label: "Not sure yet" },
];

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<Plan>("undecided");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await getSupabase().rpc("join_waitlist", { p_email: email, p_plan: plan });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else setDone(true);
  }

  if (!supabaseConfigured) return <Notice tone="warn">The waitlist isn&apos;t set up yet.</Notice>;
  if (done) return <Notice>You&apos;re on the list ✓ We&apos;ll email you when Circle Plus is ready.</Notice>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="waitlist-email">Email</Label>
        <Input
          id="waitlist-email"
          type="email"
          required
          autoComplete="email"
          maxLength={254}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <Label>Which would you pick?</Label>
        <div className="flex flex-wrap gap-2">
          {PLANS.map((p) => (
            <Chip key={p.value} selected={plan === p.value} onClick={() => setPlan(p.value)}>
              {p.label}
            </Chip>
          ))}
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy}>{busy ? "Joining…" : "Join waitlist"}</Button>
    </form>
  );
}
