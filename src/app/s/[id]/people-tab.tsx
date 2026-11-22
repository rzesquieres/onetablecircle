"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QrCode } from "@/components/qr-code";
import { Button, Card, Chip, Input, Label, Notice } from "@/components/ui";
import { billIsPaid } from "@/lib/session-rules";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/use-user";
import { timeOf, type TabProps } from "./tab-props";

export function PeopleTab({ data, me, isHost, ordersOpen, reload }: TabProps) {
  const { session, participants } = data;
  const [newPerson, setNewPerson] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const joinUrl = typeof window === "undefined" ? `/j/${session.join_code}` : `${window.location.origin}/j/${session.join_code}`;

  async function run(action: PromiseLike<{ error: unknown }>) {
    setError("");
    const { error } = await action;
    if (error) setError(friendlyError(error));
    void reload();
  }

  async function share() {
    const text = `Join our table "${session.title}" on OneTableCircle`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "OneTableCircle", text, url: joinUrl });
        return;
      } catch {
        // cancelled or unsupported: fall back to copying
      }
    }
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const active = session.status === "open" || session.status === "closed";
  // Anyone can add someone without a phone while ordering is open; the host until billing starts.
  const canAddPeople = ordersOpen || (isHost && active);

  function addPerson(e: FormEvent) {
    e.preventDefault();
    const name = newPerson.trim();
    if (!name) return;
    setNewPerson("");
    void run(getSupabase().rpc("add_offline_person", { p_session_id: session.id, p_display_name: name }));
  }

  /** People without a phone, with nothing ordered for them, can be removed by the host or whoever added them. */
  function canRemove(p: (typeof participants)[number]) {
    if (p.is_host || p.user_id || data.assignees.some((a) => a.participant_id === p.id)) return false;
    return (isHost && active) || (p.added_by === me.id && ordersOpen);
  }

  async function removePerson(id: string) {
    setError("");
    const { data: rows, error } = await getSupabase().from("participants").delete().eq("id", id).select("id");
    if (error) setError(friendlyError(error));
    else if (!rows?.length) setError("Couldn't remove them. Something may have been ordered for them.");
    void reload();
  }

  // OTC-31: the host, the person themselves, or whoever added them can mark a Senior/PWD ID.
  const paid = billIsPaid(session, data.payments);
  const canSetScPwd = (p: (typeof participants)[number]) => !paid && (isHost || p.id === me.id || p.added_by === me.id);
  function setScPwd(p: (typeof participants)[number], kind: "senior" | "pwd") {
    void run(getSupabase().rpc("set_sc_pwd", { p_participant_id: p.id, p_kind: p.sc_pwd === kind ? null : kind }));
  }

  // OTC-33: "libre" (someone covers another person's share) and celebrant mode.
  const nameFor = (id: string | null | undefined) =>
    id === me.id ? "you" : participants.find((x) => x.id === id)?.display_name ?? "someone";
  const iCover = participants.filter((p) => p.covered_by === me.id);
  const meCelebrating = Boolean(me.is_celebrant || participants.find((p) => p.id === me.id)?.is_celebrant);
  const canTreat = !paid && !meCelebrating;
  const treatable = participants.filter(
    (p) => p.id !== me.id && !p.is_celebrant && (isHost || !p.covered_by || p.covered_by === me.id),
  );
  const cover = (ids: string[], payer: string | null) =>
    ids.length ? run(getSupabase().rpc("set_covered_by", { p_participant_ids: ids, p_payer: payer })) : undefined;
  const celebrate = (p: (typeof participants)[number]) =>
    run(getSupabase().rpc("set_celebrant", { p_participant_id: p.id, p_on: !p.is_celebrant }));

  function addedLabel(p: (typeof participants)[number]) {
    if (p.is_host) return "Host";
    if (p.user_id) return `joined ${timeOf(p.joined_at)}`;
    const adder = participants.find((x) => x.id === p.added_by);
    if (!adder || adder.is_host) return "added by host";
    return adder.id === me.id ? "added by you" : `added by ${adder.display_name}`;
  }

  const updateSession = (patch: Record<string, unknown>) =>
    run(getSupabase().from("sessions").update(patch).eq("id", session.id));

  function setCutoff(minutes: number | null) {
    // Setting a new cutoff also reopens ordering if it was closed.
    void updateSession(
      minutes === null
        ? { order_cutoff_at: null }
        : { order_cutoff_at: new Date(Date.now() + minutes * 60_000).toISOString(), status: "open", closed_at: null },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <p className="text-center text-sm text-ink-soft">Scan to join this table</p>
        <QrCode value={joinUrl} label={`QR code to join ${session.title}`} />
        <p className="text-center font-mono text-2xl font-bold tracking-[0.2em]">{session.join_code}</p>
        <Button onClick={share}>{copied ? "Link copied ✓" : "Share invite link"}</Button>
        <p className="text-center text-xs text-ink-soft">
          No account needed: people can join as a guest with just their name.
        </p>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">At the table ({participants.length})</h2>
        <ul className="flex flex-col gap-1">
          {participants.map((p) => (
            <li key={p.id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-2 rounded-xl px-1">
              <span>
                {p.display_name}
                {p.id === me.id && <span className="text-ink-soft"> (you)</span>}
                {p.sc_pwd && !canSetScPwd(p) && (
                  <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                    {p.sc_pwd === "senior" ? "Senior" : "PWD"}
                  </span>
                )}
                {p.is_celebrant && (
                  <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">🎂 Celebrant</span>
                )}
                {p.covered_by && !p.is_celebrant && (
                  <span className="ml-2 text-xs text-ink-soft">covered by {nameFor(p.covered_by)}</span>
                )}
              </span>
              <span className="flex items-center gap-1 text-xs text-ink-soft">
                {addedLabel(p)}
                {canRemove(p) && (
                  <Button
                    variant="danger"
                    className="min-h-11 px-3 text-sm"
                    aria-label={`Remove ${p.display_name}`}
                    onClick={() => void removePerson(p.id)}
                  >
                    Remove
                  </Button>
                )}
              </span>
              {canSetScPwd(p) && (
                <span className="flex w-full items-center gap-2 pb-1 text-xs text-ink-soft">
                  ID discount:
                  {(["senior", "pwd"] as const).map((kind) => (
                    <Chip key={kind} selected={p.sc_pwd === kind} onClick={() => setScPwd(p, kind)} className="px-3">
                      {kind === "senior" ? "Senior" : "PWD"}
                    </Chip>
                  ))}
                </span>
              )}
              {!paid && p.id !== me.id && (isHost || (canTreat && !p.is_celebrant)) && (
                <span className="flex w-full flex-wrap items-center gap-2 pb-1 text-xs text-ink-soft">
                  {isHost && (
                    <Chip selected={Boolean(p.is_celebrant)} onClick={() => void celebrate(p)} className="px-3">
                      🎂 Celebrant
                    </Chip>
                  )}
                  {isHost && !p.is_celebrant ? (
                    <label className="flex min-h-11 items-center gap-1">
                      Paid by
                      <select
                        className="min-h-11 rounded-xl border border-line bg-surface px-2 text-sm text-ink"
                        value={p.covered_by ?? ""}
                        onChange={(e) => void cover([p.id], e.target.value || null)}
                      >
                        <option value="">themselves</option>
                        {participants
                          .filter((x) => x.id !== p.id && !x.is_celebrant)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.id === me.id ? "me" : x.display_name}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : (
                    !p.is_celebrant &&
                    canTreat &&
                    (!p.covered_by || p.covered_by === me.id) && (
                      <Chip
                        selected={p.covered_by === me.id}
                        onClick={() => void cover([p.id], p.covered_by === me.id ? null : me.id)}
                        className="px-3"
                      >
                        {p.covered_by === me.id ? "You're covering ✓" : "I'll cover them"}
                      </Chip>
                    )
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
        {canTreat && participants.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {treatable.some((p) => p.covered_by !== me.id) && (
              <Button
                variant="secondary"
                className="min-h-11 px-3 text-sm"
                onClick={() => void cover(treatable.filter((p) => p.covered_by !== me.id).map((p) => p.id), me.id)}
              >
                Libre ko! Treat everyone
              </Button>
            )}
            {iCover.length > 0 && (
              <Button variant="ghost" className="min-h-11 px-3 text-sm" onClick={() => void cover(iCover.map((p) => p.id), null)}>
                Stop covering ({iCover.length})
              </Button>
            )}
          </div>
        )}
        {participants.some((p) => p.is_celebrant || p.covered_by) && (
          <p className="mt-2 text-xs text-ink-soft">
            A celebrant&apos;s share is split evenly between everyone else. Whoever covers someone pays their whole share, including
            service charge.
          </p>
        )}
        {participants.some((p) => p.sc_pwd) && (
          <p className="mt-2 text-xs text-ink-soft">
            Senior/PWD discounts go only to the person with the ID, on their own food. Show the ID to the staff.
          </p>
        )}
        <div className="mt-3">
          <SaveAsGroup data={data} me={me} />
          <CircleLink data={data} reload={reload} />
        </div>
        {canAddPeople && (
          <form onSubmit={addPerson} className="mt-3 flex gap-2">
            <Input
              aria-label="Name of someone without a phone"
              placeholder="Add someone without a phone"
              maxLength={40}
              value={newPerson}
              onChange={(e) => setNewPerson(e.target.value)}
            />
            <Button type="submit" variant="secondary">Add</Button>
          </form>
        )}
      </section>

      {isHost && (session.status === "open" || session.status === "closed") && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Host controls</h2>

          <div>
            <Label>Order cutoff</Label>
            <p className="mb-2 text-sm">
              {session.order_cutoff_at
                ? `${new Date(session.order_cutoff_at) > new Date() ? "Closes" : "Closed"} at ${timeOf(session.order_cutoff_at)}`
                : "No cutoff set"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip selected={false} onClick={() => setCutoff(5)}>In 5 min</Chip>
              <Chip selected={false} onClick={() => setCutoff(15)}>In 15 min</Chip>
              <Chip selected={false} onClick={() => setCutoff(30)}>In 30 min</Chip>
              {session.order_cutoff_at && <Chip selected={false} onClick={() => setCutoff(null)}>Remove cutoff</Chip>}
            </div>
          </div>

          {ordersOpen ? (
            <Button variant="secondary" onClick={() => updateSession({ status: "closed", closed_at: new Date().toISOString() })}>
              Close ordering now
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => updateSession({ status: "open", closed_at: null, order_cutoff_at: null })}
            >
              Reopen ordering
            </Button>
          )}
          <p className="text-xs text-ink-soft">
            Closing stops new orders; people can still tick items as they arrive. Bill splitting comes in Phase 5.
          </p>
        </section>
      )}

      {isHost && <DeleteTable sessionId={session.id} title={session.title} people={participants.length} items={data.items.length} />}
    </div>
  );
}

/** Two-step delete (no browser pop-up): first tap explains, second tap deletes. */
function DeleteTable({ sessionId, title, people, items }: { sessionId: string; title: string; people: number; items: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    const { data, error } = await getSupabase().from("sessions").delete().eq("id", sessionId).select("id");
    if (error || !data?.length) {
      setError(error ? friendlyError(error) : "Couldn't delete this table. Only the host can delete it.");
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  return (
    <section className="mt-2 flex flex-col gap-3 border-t border-line pt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">Delete table</h2>
      {!confirming ? (
        <Button variant="secondary" className="text-danger" onClick={() => setConfirming(true)}>
          Delete this table…
        </Button>
      ) : (
        <Card className="flex flex-col gap-3 border-danger/40">
          <p className="text-sm">
            Delete <span className="font-semibold">{title}</span> for everyone? This removes all {items}{" "}
            {items === 1 ? "order" : "orders"} and {people} {people === 1 ? "person" : "people"} from it, and it can&apos;t be
            undone.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </Button>
            <Button className="flex-1 bg-danger active:bg-danger" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : "Yes, delete"}
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}

/** Save everyone at this table (except you) as a group, for quick setup next time. */
function SaveAsGroup({ data, me }: Pick<TabProps, "data" | "me">) {
  const { isGuest, loading } = useUser();
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const others = data.participants.filter((p) => p.id !== me.id);
  if (loading || isGuest || others.length === 0) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    setError("");
    const supabase = getSupabase();
    const { data: group, error } = await supabase.from("saved_groups").insert({ name: name.trim() }).select("id").single();
    if (error || !group) {
      setError(friendlyError(error));
      setState("idle");
      return;
    }
    const { error: membersError } = await supabase.from("saved_group_members").insert(
      others.map((p, i) => ({ group_id: group.id, user_id: p.user_id, display_name: p.display_name, sort_order: i })),
    );
    if (membersError) {
      setError(friendlyError(membersError));
      setState("idle");
      return;
    }
    setState("saved");
  }

  if (state === "saved") return <Notice>Saved as &quot;{name.trim()}&quot;. Pick it when you start your next table.</Notice>;
  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-2">
        <p className="text-sm font-medium">Eat together often? Save these {others.length} people as a group.</p>
        <div className="flex gap-2">
          <Input required maxLength={40} placeholder="e.g. Family, Office" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={state === "saving"}>Save</Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Card>
  );
}

/**
 * OTC-34: which Circle (saved group) this table counts towards for running
 * balances. Shows the link; the group's owner can choose or change it.
 */
function CircleLink({ data, reload }: Pick<TabProps, "data" | "reload">) {
  const { isGuest, loading, user } = useUser();
  const [groups, setGroups] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState("");
  const linked = data.session.saved_group_id ?? null;

  useEffect(() => {
    if (loading || !user || isGuest) return;
    getSupabase()
      .from("saved_groups")
      .select("id, name")
      .order("name")
      .then(({ data: rows }) => setGroups(rows ?? []));
  }, [loading, user, isGuest]);

  if (loading || !user || isGuest || !groups) return null;
  const mineLinked = linked ? groups.find((g) => g.id === linked) : undefined;
  // Linked to someone else's Circle: nothing for you to change here.
  if (linked && !mineLinked) return null;
  if (!linked && groups.length === 0) return null;

  async function link(groupId: string) {
    setError("");
    const { error } = await getSupabase().rpc("set_table_circle", { p_session_id: data.session.id, p_group_id: groupId || null });
    if (error) setError(friendlyError(error));
    void reload();
  }

  return (
    <div className="mt-3 flex flex-col gap-1">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">Count towards balances in</span>
        <select
          className="min-h-11 rounded-xl border border-line bg-surface px-2"
          value={linked ?? ""}
          onChange={(e) => void link(e.target.value)}
        >
          <option value="">No Circle</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {mineLinked && (
          <Link href={`/circles/${mineLinked.id}`} className="font-medium text-brand">
            Balances →
          </Link>
        )}
      </label>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
