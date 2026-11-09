"use client";

import { useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { resizeImage } from "@/lib/photos";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { nameOf, type TabProps } from "../tab-props";

/** Host, before the receipt is in: unserved-items warning, then scan or type the receipt. */
export function HostBillStart({ data, lines, reload }: TabProps) {
  const receipt = data.receipt;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unserved = lines.filter((l) => l.served < l.quantity);
  const scanning = receipt?.status === "scanning";

  // While the AI reads the receipt, check back every few seconds (realtime also updates it).
  useEffect(() => {
    if (!scanning) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [scanning, reload]);

  async function scan(fileList: FileList | null) {
    const files = [...(fileList ?? [])].slice(0, 4);
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("sessionId", data.session.id);
      for (const f of files) {
        const blob = await resizeImage(f, 2000, 0.85); // keep small print readable
        form.append("files", new File([blob], "receipt.jpg", { type: "image/jpeg" }));
      }
      const res = await fetch("/api/receipts/scan", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `Scan failed (error ${res.status}).`);
      await reload();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function typeItIn() {
    setBusy(true);
    setError("");
    const supabase = getSupabase();
    const { error } = receipt
      ? await supabase.from("receipts").update({ status: "review", error: null }).eq("id", receipt.id)
      : await supabase.from("receipts").insert({ session_id: data.session.id, status: "review" });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    await reload();
  }

  if (scanning) {
    return (
      <Card className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="size-8 animate-spin rounded-full border-4 border-line border-t-brand" aria-hidden />
        <p className="font-medium">Reading the receipt…</p>
        <p className="text-sm text-ink-soft">Usually under a minute.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Split the bill</h2>

      {unserved.length > 0 && (
        <Notice tone="warn">
          <span className="font-semibold">
            {unserved.reduce((n, l) => n + l.quantity - l.served, 0)} item(s) not marked as served:
          </span>{" "}
          {unserved
            .map((l) => `${l.quantity - l.served}× ${l.name}${l.optionsText ? ` (${l.optionsText})` : ""}`)
            .join(", ")}
          . If they never arrived, check they aren&apos;t on the receipt before anyone is charged for them.
        </Notice>
      )}

      {receipt?.status === "failed" && <Notice tone="error">{receipt.error || "Couldn't read that receipt."} Try again or type it in.</Notice>}

      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">
          Take a clear photo of the whole receipt, flat and well lit. For a long receipt, take up to 4 photos top to
          bottom.
        </p>
        <label
          className={`inline-flex min-h-14 cursor-pointer items-center justify-center rounded-xl bg-brand px-4 text-lg font-semibold text-white ${busy ? "opacity-50" : "active:bg-brand-strong"}`}
        >
          {busy ? "Uploading…" : "📷 Scan receipt"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void scan(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <Button variant="secondary" disabled={busy} onClick={typeItIn}>
          Type the receipt in instead
        </Button>
        {error && <Notice tone="error">{error}</Notice>}
      </Card>

      <p className="text-xs text-ink-soft">
        {data.participants.length} people at the table: {data.participants.map((p) => nameOf(data, p.id)).join(", ")}.
      </p>
    </div>
  );
}
