"use client";

import { useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, Card, Notice } from "@/components/ui";
import { publicStorageUrl } from "@/lib/menu";
import { formatMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/supabase/env";
import type { BillShareRow } from "@/lib/types";
import { nameOf, type TabProps } from "../tab-props";

export function BillSummary({ data, me, isHost, reload }: TabProps) {
  const receipt = data.receipt!;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const mine = data.shares.find((s) => s.participant_id === me.id);
  const host = data.participants.find((p) => p.is_host);
  const qrUrl = publicStorageUrl(SUPABASE_URL, "payment-qr", receipt.payment_qr_path);
  const payment = (pid: string) => data.payments.find((p) => p.participant_id === pid);
  const total = data.shares.reduce((a, s) => a + s.total_centavos, 0);
  const payers = data.shares.filter((s) => s.total_centavos > 0 && s.participant_id !== host?.id);
  const confirmed = payers.filter((s) => payment(s.participant_id)?.confirmed_at).length;
  const settled = data.session.status === "settled";

  async function call(key: string, fn: string, args: Record<string, unknown>) {
    setBusy(key);
    setError("");
    const { error } = await getSupabase().rpc(fn, args);
    setBusy("");
    if (error) setError(friendlyError(error));
    await reload();
  }

  return (
    <div className="flex flex-col gap-5">
      {settled && <Notice>✓ This table is settled. Thanks for using OneTableCircle!</Notice>}

      {mine && <MyShare share={mine} isHost={me.is_host} />}

      {!me.is_host && mine && mine.total_centavos > 0 && (
        <Card className="flex flex-col items-center gap-3 text-center">
          <p className="font-semibold">Pay {host?.display_name ?? "the host"} {formatMoney(mine.total_centavos)}</p>
          {qrUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- host's own QR image */}
              <img src={qrUrl} alt={`${host?.display_name ?? "Host"}'s payment QR code`} className="w-64 max-w-full rounded-xl bg-white p-2" />
              {receipt.payment_qr_label && <p className="text-sm text-ink-soft">{receipt.payment_qr_label}</p>}
              <p className="text-xs text-ink-soft">Screenshot or scan this with GCash / Maya. The app doesn&apos;t handle money.</p>
            </>
          ) : (
            <p className="text-sm text-ink-soft">The host hasn&apos;t added a payment QR. Pay them in cash or ask for their GCash/Maya number.</p>
          )}
          <PayButton
            state={payment(me.id)?.confirmed_at ? "confirmed" : payment(me.id)?.marked_paid_at ? "marked" : "unpaid"}
            busy={busy === "me"}
            onPaid={(paid) => call("me", "mark_paid", { p_session_id: data.session.id, p_participant_id: me.id, p_paid: paid })}
          />
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Everyone</h3>
          <span className="text-sm text-ink-soft">
            Total {formatMoney(total)}
            {payers.length > 0 && ` · ${confirmed}/${payers.length} paid`}
          </span>
        </div>
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {data.shares
            .slice()
            .sort((a, b) => order(data, a) - order(data, b))
            .map((s) => {
              const p = payment(s.participant_id);
              const isTheHost = s.participant_id === host?.id;
              const status = isTheHost
                ? "Host"
                : s.total_centavos === 0
                  ? "Nothing to pay"
                  : p?.confirmed_at
                    ? "Paid ✓"
                    : p?.marked_paid_at
                      ? "Says paid"
                      : "Not yet";
              return (
                <li key={s.participant_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-medium">{s.participant_id === me.id ? "You" : nameOf(data, s.participant_id)}</span>
                    <span className={`text-xs ${p?.confirmed_at ? "text-ok" : p?.marked_paid_at ? "text-warn" : "text-ink-soft"}`}>{status}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{formatMoney(s.total_centavos)}</span>
                    {isHost && !isTheHost && s.total_centavos > 0 && !settled && (
                      p?.confirmed_at ? (
                        <Button
                          variant="ghost"
                          className="min-h-10 px-2 text-xs"
                          disabled={busy === s.participant_id}
                          onClick={() => call(s.participant_id, "confirm_payment", { p_session_id: data.session.id, p_participant_id: s.participant_id, p_confirmed: false })}
                        >
                          Undo
                        </Button>
                      ) : (
                        <Button
                          variant={p?.marked_paid_at ? "primary" : "secondary"}
                          className="min-h-10 px-3 text-xs"
                          disabled={busy === s.participant_id}
                          onClick={() => call(s.participant_id, "confirm_payment", { p_session_id: data.session.id, p_participant_id: s.participant_id, p_confirmed: true })}
                        >
                          {p?.marked_paid_at ? "Confirm received" : "Got paid"}
                        </Button>
                      )
                    )}
                  </span>
                </li>
              );
            })}
        </ul>
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      {isHost && !settled && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Button
            variant={confirmed === payers.length ? "primary" : "secondary"}
            disabled={busy === "settle"}
            onClick={async () => {
              setBusy("settle");
              const { error } = await getSupabase().from("sessions").update({ status: "settled" }).eq("id", data.session.id);
              setBusy("");
              if (error) setError(friendlyError(error));
              await reload();
            }}
          >
            {confirmed === payers.length ? "Mark table settled" : `Mark settled anyway (${payers.length - confirmed} not confirmed)`}
          </Button>
          <ConfirmButton
            label="Take the bill back to fix it"
            question="This clears everyone's 'paid' marks."
            confirmLabel="Take it back"
            onConfirm={() => call("reopen", "reopen_bill", { p_session_id: data.session.id })}
          />
        </div>
      )}
    </div>
  );
}

function order(data: TabProps["data"], s: BillShareRow) {
  return data.participants.findIndex((p) => p.id === s.participant_id);
}

function MyShare({ share, isHost }: { share: BillShareRow; isHost: boolean }) {
  return (
    <Card className="flex flex-col gap-2">
      <p className="text-sm text-ink-soft">{isHost ? "Your share (you paid the restaurant)" : "Your share"}</p>
      <p className="text-4xl font-semibold tabular-nums">{formatMoney(share.total_centavos)}</p>
      <ul className="flex flex-col gap-0.5 border-t border-line pt-2 text-sm">
        {share.breakdown.map((b) => (
          <li key={b.lineId} className="flex justify-between gap-3">
            <span>{b.description}{b.note ? <span className="text-ink-soft"> ({b.note})</span> : null}</span>
            <span className="tabular-nums">{formatMoney(b.amount)}</span>
          </li>
        ))}
        {share.service_centavos > 0 && <Line label="Service charge" value={share.service_centavos} />}
        {share.tax_centavos > 0 && <Line label="Tax" value={share.tax_centavos} />}
        {share.tip_centavos > 0 && <Line label="Tip" value={share.tip_centavos} />}
        {share.discount_centavos > 0 && <Line label="Discount" value={-share.discount_centavos} />}
      </ul>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex justify-between gap-3 text-ink-soft">
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </li>
  );
}

function PayButton({ state, busy, onPaid }: { state: "unpaid" | "marked" | "confirmed"; busy: boolean; onPaid: (paid: boolean) => void }) {
  if (state === "confirmed") return <p className="font-semibold text-ok">Paid ✓ (confirmed by the host)</p>;
  if (state === "marked") {
    return (
      <div className="flex flex-col items-center gap-1">
        <p className="font-semibold text-warn">Marked as paid. Waiting for the host to confirm.</p>
        <Button variant="ghost" className="min-h-10 text-sm" disabled={busy} onClick={() => onPaid(false)}>
          I haven&apos;t paid yet
        </Button>
      </div>
    );
  }
  return (
    <Button className="min-h-14 w-full text-lg" disabled={busy} onClick={() => onPaid(true)}>
      {busy ? "…" : "I've paid"}
    </Button>
  );
}
