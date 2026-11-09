"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import { parseEmails } from "@/lib/emails";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { AdminGate } from "../admin-gate";

interface Tester {
  email: string;
  note: string;
  created_at: string;
}

export function TestersAdmin() {
  return (
    <AdminGate>
      <Testers />
    </AdminGate>
  );
}

async function fetchAll() {
  const supabase = getSupabase();
  const [t, c] = await Promise.all([
    supabase.from("beta_testers").select("email, note, created_at").order("created_at", { ascending: false }),
    supabase.from("app_config").select("invite_only").maybeSingle(),
  ]);
  return { testers: (t.data as Tester[]) ?? [], inviteOnly: Boolean(c.data?.invite_only), error: t.error ?? c.error };
}

function Testers() {
  const [testers, setTesters] = useState<Tester[] | null>(null);
  const [inviteOnly, setInviteOnly] = useState(true);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const r = await fetchAll();
    if (r.error) setError(friendlyError(r.error));
    setTesters(r.testers);
    setInviteOnly(r.inviteOnly);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then((r) => {
      if (cancelled) return;
      if (r.error) setError(friendlyError(r.error));
      setTesters(r.testers);
      setInviteOnly(r.inviteOnly);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const { valid, invalid } = parseEmails(text);
    if (!valid.length) return setError(invalid.length ? `Not an email: ${invalid.join(", ")}` : "Type an email address.");
    setBusy(true);
    const { error } = await getSupabase()
      .from("beta_testers")
      .upsert(valid.map((email) => ({ email, note: note.trim() })), { onConflict: "email", ignoreDuplicates: true });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setMessage(
      `Added ${valid.length} tester${valid.length === 1 ? "" : "s"}.${invalid.length ? ` Skipped (not emails): ${invalid.join(", ")}` : ""}`,
    );
    setText("");
    setNote("");
    await load();
  }

  async function toggle(next: boolean) {
    setError("");
    const { error } = await getSupabase()
      .from("app_config")
      .update({ invite_only: next, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) setError(friendlyError(error));
    await load();
  }

  const shown = (testers ?? []).filter((t) => `${t.email} ${t.note}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-soft">← Admin</Link>
        <h1 className="text-2xl font-semibold">Testers</h1>
        <p className="text-sm text-ink-soft">
          While the app is invite-only, only these emails (and admins) can create an account and host tables. Anyone can
          still join a table as a guest using its link.
        </p>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{inviteOnly ? "Invite-only is ON" : "Invite-only is OFF"}</p>
          <p className="text-sm text-ink-soft">
            {inviteOnly ? "New accounts need to be on this list." : "Anyone can create an account and host tables."}
          </p>
        </div>
        {inviteOnly ? (
          <ConfirmButton
            label="Turn off (open to everyone)"
            question="Let anyone sign up?"
            confirmLabel="Turn off"
            onConfirm={() => toggle(false)}
          />
        ) : (
          <Button onClick={() => toggle(true)}>Turn on invite-only</Button>
        )}
      </Card>

      <Card>
        <form onSubmit={add} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="emails">Add testers</Label>
            <textarea
              id="emails"
              rows={3}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base"
              placeholder={"ana@gmail.com\nben@yahoo.com, carla@company.ph"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-soft">One or many: separate with commas, spaces or new lines.</p>
          </div>
          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" maxLength={100} placeholder="e.g. Office friends" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {message && <Notice>{message}</Notice>}
          <div>
            <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
          </div>
          <p className="text-xs text-ink-soft">
            They sign up at onetablecircle.com with that email (email + password or Google). The app doesn&apos;t send
            invitations; tell them yourself.
          </p>
        </form>
      </Card>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">On the list ({testers?.length ?? 0})</h2>
        </div>
        <Input aria-label="Search testers" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {testers === null ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-soft">No testers {filter ? "match" : "yet"}.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
            {shown.map((t) => (
              <li key={t.email} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block break-all font-medium">{t.email}</span>
                  <span className="text-xs text-ink-soft">
                    {t.note ? `${t.note} · ` : ""}added {new Date(t.created_at).toLocaleDateString("en-PH")}
                  </span>
                </span>
                <ConfirmButton
                  small
                  label="Remove"
                  confirmLabel="Remove"
                  onConfirm={async () => {
                    const { error } = await getSupabase().from("beta_testers").delete().eq("email", t.email);
                    if (error) setError(friendlyError(error));
                    await load();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-soft">
          Removing someone stops them hosting new tables and signing up again. It doesn&apos;t delete an account they
          already have.
        </p>
      </section>
    </div>
  );
}
