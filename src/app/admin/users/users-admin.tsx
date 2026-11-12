"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/use-user";
import { AdminGate } from "../admin-gate";

interface UserRow {
  user_id: string;
  email: string | null;
  display_name: string;
  is_platform_admin: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  removed_at: string | null;
  active_tables: number;
  hosting_tables: number;
  unpaid_bills: number;
}

interface Removal {
  id: number;
  email: string | null;
  display_name: string;
  reason: string;
  allow_signup: boolean;
  removed_at: string;
}

export function UsersAdmin() {
  return (
    <AdminGate>
      <Users />
    </AdminGate>
  );
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-PH") : "never");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function fetchAll() {
  const supabase = getSupabase();
  const [u, r] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase
      .from("user_removals")
      .select("id, email, display_name, reason, allow_signup, removed_at")
      .order("removed_at", { ascending: false })
      .limit(20),
  ]);
  return { users: (u.data as UserRow[]) ?? [], removals: (r.data as Removal[]) ?? [], error: u.error ?? r.error };
}

function Users() {
  const { user: me } = useUser();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [removals, setRemovals] = useState<Removal[]>([]);
  const [filter, setFilter] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchAll>>) => {
    if (r.error) setError(friendlyError(r.error));
    setUsers(r.users);
    setRemovals(r.removals);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then((r) => {
      if (!cancelled) apply(r);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const q = filter.trim().toLowerCase();
  const shown = (users ?? []).filter(
    (u) => (showRemoved || !u.removed_at) && `${u.display_name} ${u.email ?? ""}`.toLowerCase().includes(q),
  );
  const removedCount = (users ?? []).filter((u) => u.removed_at).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-soft">← Admin</Link>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-ink-soft">
          Everyone with an account. Quick guests who joined a table by link aren&apos;t listed.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice>{message}</Notice>}

      <section className="flex flex-col gap-2">
        <Input aria-label="Search users" placeholder="Search name or email…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {removedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
            Show removed users ({removedCount})
          </label>
        )}
        {users === null ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-soft">No users {q ? "match" : "yet"}.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
            {shown.map((u) => (
              <li key={u.user_id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {u.display_name || "(no name)"}
                      {u.is_platform_admin && (
                        <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">Admin</span>
                      )}
                      {u.user_id === me?.id && <span className="text-xs text-ink-soft">(you)</span>}
                      {u.removed_at && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink-soft">
                          Removed {date(u.removed_at)}
                        </span>
                      )}
                    </span>
                    <span className="block break-all text-sm">{u.email}</span>
                    <span className="text-xs text-ink-soft">
                      Joined {date(u.created_at)} · last sign-in {date(u.last_sign_in_at)}
                    </span>
                  </span>
                  {!u.removed_at && u.user_id !== me?.id && confirming !== u.user_id && (
                    <Button
                      variant="danger"
                      className="min-h-9 px-2 text-sm"
                      onClick={() => {
                        setConfirming(u.user_id);
                        setMessage("");
                        setError("");
                      }}
                    >
                      Remove user
                    </Button>
                  )}
                </div>
                {confirming === u.user_id && (
                  <RemoveConfirm
                    user={u}
                    onCancel={() => setConfirming(null)}
                    onDone={async (msg) => {
                      setConfirming(null);
                      setMessage(msg);
                      apply(await fetchAll());
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {removals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Removal log</h2>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {removals.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <span className="block break-all font-medium">
                  {r.display_name || "(no name)"} · {r.email}
                </span>
                <span className="text-xs text-ink-soft">
                  {new Date(r.removed_at).toLocaleString("en-PH")}
                  {r.allow_signup ? " · can sign up again" : " · email blocked"}
                  {r.reason ? ` · ${r.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RemoveConfirm({
  user,
  onCancel,
  onDone,
}: {
  user: UserRow;
  onCancel: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [allowSignup, setAllowSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = user.display_name || user.email || "this user";

  const warnings: string[] = [];
  if (user.unpaid_bills > 0) {
    warnings.push(`They haven't paid ${plural(user.unpaid_bills, "bill")} yet. The amounts stay on the bill, under "Removed user".`);
  }
  if (user.hosting_tables > 0) {
    warnings.push(`They host ${plural(user.hosting_tables, "table")} that ${user.hosting_tables === 1 ? "isn't" : "aren't"} settled. Nobody else can manage ${user.hosting_tables === 1 ? "it" : "them"} as host.`);
  } else if (user.active_tables > 0) {
    warnings.push(`They're at ${plural(user.active_tables, "table")} that ${user.active_tables === 1 ? "isn't" : "aren't"} settled yet.`);
  }
  if (user.is_platform_admin) warnings.push("They're an admin and will lose admin access.");

  async function remove() {
    setBusy(true);
    setError("");
    const { error } = await getSupabase().rpc("admin_remove_user", {
      p_user_id: user.user_id,
      p_reason: reason.trim(),
      p_allow_signup: allowSignup,
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    await onDone(`Removed ${name}${user.email && user.email !== name ? ` (${user.email})` : ""}.`);
  }

  return (
    <Card className="flex flex-col gap-3 border-danger/40">
      <p className="font-semibold">
        Remove {user.display_name || "(no name)"} <span className="break-all font-normal">({user.email})</span>?
      </p>
      <p className="text-sm text-ink-soft">
        They&apos;ll be signed out and can&apos;t sign in to this account again. Past tables and bills stay the same for
        everyone else, with their name shown as &quot;Removed user&quot;.
      </p>
      {warnings.map((w) => (
        <Notice key={w} tone="warn">{w}</Notice>
      ))}
      <div>
        <Label htmlFor={`reason-${user.user_id}`}>Reason (optional, only admins see it)</Label>
        <Input
          id={`reason-${user.user_id}`}
          maxLength={200}
          placeholder="e.g. Asked to be removed"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={allowSignup}
          onChange={(e) => setAllowSignup(e.target.checked)}
        />
        <span>
          <span className="block font-medium">Let this email sign up again</span>
          <span className="text-ink-soft">
            {allowSignup
              ? "They can create a new account with this email (or the same Google account). It starts empty, with no link to this account's history."
              : "Leave off for abuse or spam: this email stays blocked and is taken off the testers list."}
          </span>
        </span>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button className="bg-danger active:bg-danger" onClick={remove} disabled={busy}>
          {busy ? "Removing…" : "Remove user"}
        </Button>
      </div>
    </Card>
  );
}
