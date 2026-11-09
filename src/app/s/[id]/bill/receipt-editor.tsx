"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, Card, Chip, Input, Label, Notice } from "@/components/ui";
import { optionsText } from "@/lib/consolidate";
import { formatMoney, moneyInputText as pesoText, parseMoney } from "@/lib/money";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import type { LineSplit, ReceiptLine } from "@/lib/types";
import { nameOf, type TabProps } from "../tab-props";
import { billFor, sharesPayload } from "./bill-data";

const money = (text: string) => (text.trim() ? parseMoney(text) : 0);

export function ReceiptEditor({ data, me, reload }: TabProps) {
  const receipt = data.receipt!;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasQr, setHasQr] = useState<boolean | null>(null);
  const result = useMemo(() => billFor(data), [data]);
  const supabase = () => getSupabase();

  useEffect(() => {
    getSupabase()
      .from("profiles")
      .select("payment_qr_path")
      .eq("user_id", me.user_id ?? "")
      .maybeSingle()
      .then(({ data: p }) => setHasQr(Boolean(p?.payment_qr_path)));
  }, [me.user_id]);

  async function run(action: PromiseLike<{ error: unknown }>) {
    setError("");
    const { error } = await action;
    if (error) setError(friendlyError(error));
    await reload();
  }

  const matchedIds = new Set(data.lineItems.map((x) => x.order_item_id));
  const notOnReceipt = data.items.filter((i) => !matchedIds.has(i.id));
  const printed = receipt.printed_total_centavos;
  const mismatch = printed !== null && data.lines.length > 0 && printed !== result.total;
  const warnings = receipt.ai_output?.warnings ?? [];

  async function send() {
    setBusy(true);
    setError("");
    const { error } = await supabase().rpc("finalize_bill", {
      p_session_id: data.session.id,
      p_shares: sharesPayload(result),
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    await reload();
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Check the receipt</h2>
        <ConfirmButton
          small
          label="Start over"
          question="Delete this receipt?"
          confirmLabel="Delete"
          onConfirm={() => run(supabase().from("receipts").delete().eq("id", receipt.id))}
        />
      </div>

      <ReceiptPhotos paths={receipt.image_paths} />

      {warnings.length > 0 && (
        <Notice tone="warn">
          {warnings.map((w, i) => (
            <span key={i} className="block">{w}</span>
          ))}
        </Notice>
      )}

      <section className="flex flex-col gap-2">
        <p className="text-sm text-ink-soft">
          Check each line against the receipt, and who pays for it. Lines matched to ordered items are split the same way
          as the order.
        </p>
        {data.lines.map((line) => (
          <LineCard key={line.id} line={line} props={{ data, me, reload }} run={run} />
        ))}
        <Button
          variant="secondary"
          onClick={() =>
            run(
              supabase().from("receipt_lines").insert({
                receipt_id: receipt.id,
                session_id: data.session.id,
                description: "Item",
                amount_centavos: 0,
                sort_order: data.lines.length,
              }),
            )
          }
        >
          + Add a line
        </Button>
      </section>

      <Charges data={data} run={run} itemsTotal={result.itemsTotal} />

      <Card className="flex flex-col gap-1">
        <div className="flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(result.total)}</span>
        </div>
        {printed !== null && (
          <p className={`text-sm ${mismatch ? "font-semibold text-warn" : "text-ink-soft"}`}>
            Receipt says {formatMoney(printed)}
            {mismatch ? ` · off by ${formatMoney(Math.abs(printed - result.total))}. Check the lines and charges.` : " ✓"}
          </p>
        )}
      </Card>

      {notOnReceipt.length > 0 && (
        <Notice>
          Ordered but not matched to the receipt (nobody pays for these):{" "}
          {notOnReceipt.map((i) => `${i.quantity}× ${i.name}`).join(", ")}. Match them to a line if they&apos;re on it.
        </Notice>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Everyone pays</h3>
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {result.shares.map((s) => (
            <li key={s.participantId}>
              <details className="px-3 py-2">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between">
                  <span>{s.participantId === me.id ? "You" : nameOf(data, s.participantId)}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(s.total)}</span>
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-soft">
                  {s.breakdown.map((b) => (
                    <li key={b.lineId} className="flex justify-between gap-3">
                      <span>{b.description}{b.note ? ` (${b.note})` : ""}</span>
                      <span className="tabular-nums">{formatMoney(b.amount)}</span>
                    </li>
                  ))}
                  {s.service > 0 && <Row label="Service charge" value={s.service} />}
                  {s.tax > 0 && <Row label="Tax" value={s.tax} />}
                  {s.tip > 0 && <Row label="Tip" value={s.tip} />}
                  {s.discount > 0 && <Row label="Discount" value={-s.discount} />}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {hasQr === false && (
        <Notice tone="warn">
          Add your GCash or Maya QR code in{" "}
          <Link href="/profile" className="font-semibold underline">your profile</Link> so people can scan it to pay you.
          (You can still send the bill without it.)
        </Notice>
      )}
      {result.problems.length > 0 && <Notice tone="warn">{result.problems.join(" · ")}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        className="min-h-14 text-lg"
        disabled={busy || result.problems.length > 0 || data.lines.length === 0}
        onClick={send}
      >
        {busy ? "Sending…" : `Send the bill to everyone (${formatMoney(result.total)})`}
      </Button>
      <p className="text-center text-xs text-ink-soft">Sending closes the table to new orders. You can take the bill back to fix it.</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </li>
  );
}

function ReceiptPhotos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const key = paths.join("|");
  useEffect(() => {
    if (!open || !key) return;
    getSupabase()
      .storage.from("receipts")
      .createSignedUrls(key.split("|"), 3600)
      .then(({ data }) => setUrls((data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]));
  }, [open, key]);
  if (!paths.length) return null;
  return (
    <div>
      <Button variant="ghost" className="min-h-11 px-0 text-sm text-brand" onClick={() => setOpen(!open)}>
        {open ? "Hide receipt photo" : "Show receipt photo"}
      </Button>
      {open && (
        <div className="flex flex-col gap-2">
          {urls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img key={u} src={u} alt="Receipt" className="w-full rounded-xl border border-line" />
          ))}
        </div>
      )}
    </div>
  );
}

function LineCard({
  line,
  props,
  run,
}: {
  line: ReceiptLine;
  props: Pick<TabProps, "data" | "me" | "reload">;
  run: (a: PromiseLike<{ error: unknown }>) => Promise<void>;
}) {
  const { data } = props;
  const [desc, setDesc] = useState(line.description);
  const [qty, setQty] = useState(String(line.quantity));
  const [amount, setAmount] = useState(pesoText(line.amount_centavos));
  const [bad, setBad] = useState(false);
  const sb = () => getSupabase();

  const matched = data.lineItems.filter((x) => x.receipt_line_id === line.id).map((x) => x.order_item_id);
  const people = data.linePeople.filter((x) => x.receipt_line_id === line.id).map((x) => x.participant_id);
  const elsewhere = new Set(data.lineItems.filter((x) => x.receipt_line_id !== line.id).map((x) => x.order_item_id));
  const label = (id: string) => {
    const i = data.items.find((x) => x.id === id);
    if (!i) return "Removed item";
    const who = data.assignees
      .filter((a) => a.order_item_id === id)
      .map((a) => nameOf(data, a.participant_id))
      .join(", ");
    return `${i.quantity}× ${i.name}${optionsText(i) ? ` (${optionsText(i)})` : ""} · ${who}`;
  };

  function save() {
    const cents = money(amount);
    const q = Math.min(999, Math.max(1, Math.floor(Number(qty) || 1)));
    if (cents === null || cents < 0) return setBad(true);
    setBad(false);
    if (desc.trim() === line.description && q === line.quantity && cents === line.amount_centavos) return;
    void run(sb().from("receipt_lines").update({ description: desc.trim() || "Item", quantity: q, amount_centavos: cents }).eq("id", line.id));
  }

  const setSplit = (split: LineSplit) => run(sb().from("receipt_lines").update({ split }).eq("id", line.id));
  const unassigned =
    (line.split === "items" && matched.length === 0) || (line.split === "people" && people.length === 0);

  return (
    <Card className={`flex flex-col gap-3 ${unassigned ? "border-warn" : ""}`}>
      <div className="flex items-center gap-2">
        <Input className="min-w-0 flex-1" maxLength={120} aria-label="Receipt line" value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={save} />
        <Input className="w-14 text-center" inputMode="numeric" aria-label="Quantity" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} onBlur={save} />
        <Input className={`w-24 text-right ${bad ? "border-danger" : ""}`} inputMode="decimal" aria-label="Line total" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={save} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">Paid by:</span>
        <Chip selected={line.split === "items"} onClick={() => setSplit("items")} className="min-h-9 px-3">Ordered item</Chip>
        <Chip selected={line.split === "people"} onClick={() => setSplit("people")} className="min-h-9 px-3">Choose people</Chip>
        <Chip selected={line.split === "everyone"} onClick={() => setSplit("everyone")} className="min-h-9 px-3">Everyone</Chip>
        <span className="flex-1" />
        <ConfirmButton small label="✕" confirmLabel="Delete line" onConfirm={() => run(sb().from("receipt_lines").delete().eq("id", line.id))} />
      </div>

      {line.split === "items" && (
        <div className="flex flex-col gap-2">
          {matched.map((id) => (
            <div key={id} className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <span className="min-w-0">{label(id)}</span>
              <button
                className="min-h-9 shrink-0 px-2 text-ink-soft"
                aria-label="Unmatch"
                onClick={() => run(sb().from("receipt_line_items").delete().eq("receipt_line_id", line.id).eq("order_item_id", id))}
              >
                ✕
              </button>
            </div>
          ))}
          <select
            className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm"
            value=""
            onChange={(e) =>
              e.target.value &&
              run(sb().from("receipt_line_items").insert({ receipt_line_id: line.id, order_item_id: e.target.value, session_id: line.session_id }))
            }
          >
            <option value="">{matched.length ? "+ Add another ordered item…" : "Match to an ordered item…"}</option>
            {data.items
              .filter((i) => !matched.includes(i.id))
              .sort((a, b) => Number(elsewhere.has(a.id)) - Number(elsewhere.has(b.id)))
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {elsewhere.has(i.id) ? "(already matched) " : ""}
                  {label(i.id)}
                </option>
              ))}
          </select>
        </div>
      )}

      {line.split === "people" && (
        <div className="flex flex-wrap gap-2">
          {data.participants.map((p) => {
            const on = people.includes(p.id);
            return (
              <Chip
                key={p.id}
                selected={on}
                onClick={() =>
                  run(
                    on
                      ? sb().from("receipt_line_people").delete().eq("receipt_line_id", line.id).eq("participant_id", p.id)
                      : sb().from("receipt_line_people").insert({ receipt_line_id: line.id, participant_id: p.id, session_id: line.session_id }),
                  )
                }
              >
                {p.id === props.me.id ? "Me" : p.display_name}
              </Chip>
            );
          })}
        </div>
      )}

      {line.split === "everyone" && <p className="text-xs text-ink-soft">Split equally between all {data.participants.length} people.</p>}
    </Card>
  );
}

function Charges({
  data,
  run,
  itemsTotal,
}: Pick<TabProps, "data"> & { run: (a: PromiseLike<{ error: unknown }>) => Promise<void>; itemsTotal: number }) {
  const r = data.receipt!;
  const [service, setService] = useState(pesoText(r.service_charge_centavos));
  const [tax, setTax] = useState(pesoText(r.tax_centavos));
  const [discount, setDiscount] = useState(pesoText(r.discount_centavos));
  const [tip, setTip] = useState(pesoText(r.tip_centavos));
  const [bad, setBad] = useState("");
  const tenPct = Math.round((itemsTotal * data.session.service_charge_bps) / 10000);

  function save(next?: Partial<Record<"service" | "tax" | "discount" | "tip", string>>) {
    const v = { service, tax, discount, tip, ...next };
    const c = { service: money(v.service), tax: money(v.tax), discount: money(v.discount), tip: money(v.tip) };
    const wrong = Object.entries(c).find(([, x]) => x === null || x < 0);
    if (wrong) return setBad(wrong[0]);
    setBad("");
    void run(
      getSupabase()
        .from("receipts")
        .update({
          service_charge_centavos: c.service,
          tax_centavos: c.tax,
          discount_centavos: c.discount,
          tip_centavos: c.tip,
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id),
    );
  }

  const field = (key: "service" | "tax" | "discount" | "tip", label: string, value: string, set: (s: string) => void, hint?: string) => (
    <div>
      <Label>{label}</Label>
      <Input inputMode="decimal" className={bad === key ? "border-danger" : ""} value={value} onChange={(e) => set(e.target.value)} onBlur={() => save()} />
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm font-semibold">Charges (split by how much each person ordered)</p>
      <div className="grid grid-cols-2 gap-3">
        {field("service", "Service charge ₱", service, setService)}
        {field("discount", "Discount ₱", discount, setDiscount, "Senior/PWD, promos")}
        {field("tax", "Tax added ₱", tax, setTax, "Only if not already in prices")}
        {field("tip", "Tip ₱", tip, setTip)}
      </div>
      {data.session.service_charge_bps > 0 && (
        <Button
          variant="ghost"
          className="min-h-10 self-start px-0 text-sm text-brand"
          onClick={() => {
            const s = pesoText(tenPct);
            setService(s);
            save({ service: s });
          }}
        >
          Use {data.session.service_charge_bps / 100}% of items ({formatMoney(tenPct)})
        </Button>
      )}
    </Card>
  );
}
