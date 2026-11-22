"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import { computeLedger, type Ledger, type LedgerMember, type LedgerSettlement, type LedgerTable, type Transfer } from "@/lib/ledger";
import { formatMoney, parseMoney } from "@/lib/money";
import { hasCirclePlus } from "@/lib/plans";
import { friendlyError, getSupabase } from "@/lib/supabase/client";

interface Raw {
  group: { id: string; name: string };
  me: string | null;
  is_owner: boolean;
  members: { id: string; name: string }[] | null;
  tables: { session_id: string; title: string; date: string; host_key: string | null; shares: { key: string | null; total: number; paid: boolean }[] }[];
  settlements: { id: string; from: string; to: string; amount: number; note: string; created_at: string; mine: boolean }[];
}

/** OTC-34: running balances for one Circle (saved group). */
export function CircleScreen() {
  const { id } = useParams<{ id: string }>();
  const [raw, setRaw] = useState<Raw | null>(null);
  const [error, setError] = useState("");
  const [prefill, setPrefill] = useState<Transfer | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("circle_ledger", { p_group_id: id });
    if (error) setError(friendlyError(error));
    else {
      setError("");
      setRaw(data as Raw);
    }
  }, [id]);

  useEffect(() => {
    // Loading data from Supabase is the effect here; the state updates follow the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const members: LedgerMember[] = useMemo(() => raw?.members ?? [], [raw]);
  const ledger: Ledger | null = useMemo(() => {
    if (!raw) return null;
    const tables: LedgerTable[] = raw.tables.map((t) => ({
      sessionId: t.session_id,
      title: t.title,
      date: t.date,
      hostMemberId: t.host_key,
      shares: t.shares.filter((s) => s.key).map((s) => ({ memberId: s.key!, total: Number(s.total), paid: s.paid })),
    }));
    const settlements: LedgerSettlement[] = raw.settlements.map((s) => ({
      id: s.id,
      fromMemberId: s.from,
      toMemberId: s.to,
      amount: Number(s.amount),
      createdAt: s.created_at,
      note: s.note,
    }));
    return computeLedger(members, tables, settlements);
  }, [raw, members]);

  if (error && !raw) {
    return (
      <div className="flex flex-col gap-3">
        <Link href="/circles" className="text-sm text-ink-soft">← Circles</Link>
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }
  if (!raw || !ledger) return <Spinner label="Loading balances…" />;

  const name = (key: string) => (key === raw.me ? "You" : members.find((m) => m.id === key)?.name ?? "Someone");
  const plus = hasCirclePlus();
  const mine = raw.me ? ledger.balances[raw.me] ?? 0 : null;
  const square = Object.values(ledger.balances).every((v) => v === 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/circles" className="text-sm text-ink-soft">← Circles</Link>
        <h1 className="text-2xl font-semibold">{raw.group.name}</h1>
        <p className="text-sm text-ink-soft">
          {raw.tables.length} {raw.tables.length === 1 ? "meal" : "meals"} · unpaid shares are owed to whoever hosted
        </p>
      </div>

      {mine !== null && (
        <Card className="flex flex-col gap-1 text-center">
          <p className="text-sm text-ink-soft">{mine > 0 ? "You're owed" : mine < 0 ? "You owe" : "You're"}</p>
          <p className={`text-4xl font-semibold tabular-nums ${mine > 0 ? "text-ok" : ""}`}>
            {mine === 0 ? "All square" : formatMoney(Math.abs(mine))}
          </p>
        </Card>
      )}

      {square ? (
        <Notice>✓ Everyone in {raw.group.name} is square.</Notice>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Balances</h2>
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
              {members.map((m) => {
                const v = ledger.balances[m.id] ?? 0;
                return (
                  <li key={m.id} className="flex items-center justify-between px-3 py-2">
                    <span>{name(m.id)}</span>
                    <span className={`tabular-nums ${v > 0 ? "text-ok" : v < 0 ? "" : "text-ink-soft"}`}>
                      {v > 0 ? `gets ${formatMoney(v)}` : v < 0 ? `owes ${formatMoney(-v)}` : "square"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
              {plus ? "Settle up in the fewest payments" : "Who owes whom"}
              {plus && <PlusBadge />}
            </h2>
            <ul className="flex flex-col gap-2">
              {(plus ? ledger.simplified : ledger.pairs).map((t) => (
                <li key={`${t.from}-${t.to}`}>
                  <Card className="flex items-center justify-between gap-3 py-3">
                    <span>
                      <span className="font-medium">{name(t.from)}</span> {t.from === raw.me ? "pay" : "pays"}{" "}
                      <span className="font-medium">{name(t.to)}</span>
                      <span className="block font-semibold tabular-nums">{formatMoney(t.amount)}</span>
                    </span>
                    {canRecord(raw, t.from, t.to) && (
                      <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setPrefill(t)}>
                        Mark paid
                      </Button>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
            {plus && ledger.pairs.length > ledger.simplified.length && (
              <p className="text-xs text-ink-soft">
                {ledger.pairs.length} debts between people, settled with {ledger.simplified.length}{" "}
                {ledger.simplified.length === 1 ? "payment" : "payments"}.
              </p>
            )}
          </section>
        </>
      )}

      <RecordPayment raw={raw} name={name} prefill={prefill} onDone={() => { setPrefill(null); void load(); }} />

      {plus && <History raw={raw} ledger={ledger} name={name} reload={load} />}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function PlusBadge() {
  return (
    <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 align-middle text-[10px] font-semibold normal-case tracking-normal text-brand">
      Circle Plus · free in beta
    </span>
  );
}

/** The owner can record any payment; a member only ones they made or received (the database checks too). */
function canRecord(raw: Raw, from: string, to: string) {
  return raw.is_owner || raw.me === from || raw.me === to;
}

function RecordPayment({
  raw,
  name,
  prefill,
  onDone,
}: {
  raw: Raw;
  name: (key: string) => string;
  prefill: Transfer | null;
  onDone: () => void;
}) {
  const members = raw.members ?? [];
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // "Mark paid" on a suggested payment fills the form in.
  useEffect(() => {
    if (!prefill) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
    setFrom(prefill.from);
    setTo(prefill.to);
    setAmount((prefill.amount / 100).toFixed(2));
  }, [prefill]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const centavos = parseMoney(amount);
    if (!from || !to || from === to) return setError("Choose who paid and who received it.");
    if (!centavos || centavos <= 0) return setError("Enter the amount.");
    setBusy(true);
    setError("");
    const { error } = await getSupabase().rpc("record_circle_settlement", {
      p_group_id: raw.group.id,
      p_from: from,
      p_to: to,
      p_amount: centavos,
      p_note: note.trim(),
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setOpen(false);
    setAmount("");
    setNote("");
    onDone();
  }

  if (!open) {
    return (
      <Button variant="ghost" className="self-start px-0 text-brand" onClick={() => setOpen(true)}>
        + Record a payment
      </Button>
    );
  }
  const choices = members;
  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-3">
        <p className="font-semibold">Record a payment</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pay-from">Who paid</Label>
            <select id="pay-from" className="min-h-12 w-full rounded-xl border border-line bg-surface px-2" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose…</option>
              {choices.map((m) => (
                <option key={m.id} value={m.id}>{name(m.id)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pay-to">Who received it</Label>
            <select id="pay-to" className="min-h-12 w-full rounded-xl border border-line bg-surface px-2" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {choices.filter((m) => m.id !== from).map((m) => (
                <option key={m.id} value={m.id}>{name(m.id)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pay-amount">Amount ₱</Label>
            <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Input id="pay-note" maxLength={80} placeholder="GCash, cash…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {!raw.is_owner && <p className="text-xs text-ink-soft">You can record payments you made or received.</p>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Card>
  );
}

function History({ raw, ledger, name, reload }: { raw: Raw; ledger: Ledger; name: (key: string) => string; reload: () => Promise<void> }) {
  const members = raw.members ?? [];
  const [who, setWho] = useState<string>(raw.me ?? members[0]?.id ?? "");
  const [error, setError] = useState("");
  const entries = ledger.history[who] ?? [];
  const settlement = (sid?: string) => raw.settlements.find((s) => s.id === sid);

  async function undo(sid: string) {
    setError("");
    const { error } = await getSupabase().rpc("delete_circle_settlement", { p_settlement_id: sid });
    if (error) setError(friendlyError(error));
    await reload();
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
        History
        <PlusBadge />
      </h2>
      <select
        aria-label="Whose history"
        className="min-h-11 rounded-xl border border-line bg-surface px-2"
        value={who}
        onChange={(e) => setWho(e.target.value)}
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>{name(m.id)}</option>
        ))}
      </select>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing owed either way yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {entries.map((h, k) => {
            const s = settlement(h.settlementId);
            return (
              <li key={`${h.sessionId ?? h.settlementId}-${k}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  {h.sessionId ? (
                    <Link href={`/s/${h.sessionId}`} className="block truncate font-medium underline-offset-2 hover:underline">{h.title}</Link>
                  ) : (
                    <span className="block truncate font-medium">
                      {s ? `${name(s.from)} paid ${name(s.to)}` : "Payment"}
                      {h.title !== "Settled up" ? ` · ${h.title}` : ""}
                    </span>
                  )}
                  <span className="text-xs text-ink-soft">{new Date(h.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`tabular-nums ${h.amount > 0 ? "text-ok" : ""}`}>
                    {h.amount > 0 ? "+" : "−"}
                    {formatMoney(Math.abs(h.amount))}
                  </span>
                  {s && (raw.is_owner || s.mine) && (
                    <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => void undo(s.id)}>Undo</Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-ink-soft">+ means {who === raw.me ? "you're" : `${name(who)} is`} owed more; − means owes more.</p>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
