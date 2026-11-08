"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, Chip, Input, Label, Notice } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
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

  function addPerson(e: FormEvent) {
    e.preventDefault();
    const name = newPerson.trim();
    if (!name) return;
    setNewPerson("");
    void run(getSupabase().from("participants").insert({ session_id: session.id, display_name: name }));
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
        <p className="text-sm text-ink-soft">Invite people with this code or link</p>
        <p className="text-center font-mono text-3xl font-bold tracking-[0.2em]">{session.join_code}</p>
        <Button onClick={share}>{copied ? "Link copied ✓" : "Share invite link"}</Button>
        <p className="text-xs text-ink-soft">They&apos;ll need to sign in. QR codes and quick guest access come in Phase 2.</p>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">At the table ({participants.length})</h2>
        <ul className="flex flex-col gap-1">
          {participants.map((p) => (
            <li key={p.id} className="flex min-h-11 items-center justify-between rounded-xl px-1">
              <span>
                {p.display_name}
                {p.id === me.id && <span className="text-ink-soft"> (you)</span>}
              </span>
              <span className="text-xs text-ink-soft">
                {p.is_host ? "Host" : p.user_id ? `joined ${timeOf(p.joined_at)}` : "added by host"}
              </span>
            </li>
          ))}
        </ul>
        {isHost && (
          <form onSubmit={addPerson} className="mt-3 flex gap-2">
            <Input placeholder="Add someone without a phone" maxLength={40} value={newPerson} onChange={(e) => setNewPerson(e.target.value)} />
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
    </div>
  );
}
