import { after, type NextRequest } from "next/server";
import { suggestMatches } from "@/lib/bill";
import { aiConfigured, extractReceipt } from "@/lib/ai/claude";
import { toReceiptRows } from "@/lib/ai/receipt-draft";
import { fileBlocks } from "@/lib/ai/source";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";
import type { OrderItem } from "@/lib/types";

const MAX_FILES = 4;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * Host uploads receipt photo(s). Saves them privately, marks the receipt as
 * "scanning", returns at once; the AI reads it in the background, fills in
 * the lines and charges, and pre-matches lines to ordered items.
 * Form fields: sessionId, files[] (images, already shrunk in the browser).
 */
export async function POST(request: NextRequest) {
  if (!supabaseConfigured) return fail(503, "The app isn't connected to its database yet.");
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail(401, "Please sign in again.");
  if (!aiConfigured()) return fail(503, "Receipt scanning isn't set up yet. You can type the receipt in instead.");

  const form = await request.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  const { data: isHost } = await supabase.rpc("is_session_host", { p_session_id: sessionId });
  if (!isHost) return fail(403, "Only the host can scan the receipt.");

  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!uploads.length) return fail(400, "Take or choose a photo of the receipt.");
  if (uploads.length > MAX_FILES) return fail(400, `Up to ${MAX_FILES} photos (for long receipts).`);
  let total = 0;
  const files: { type: string; data: Buffer }[] = [];
  for (const f of uploads) {
    if (!TYPES.has(f.type)) return fail(400, "Please use a photo (JPG, PNG or WebP).");
    total += f.size;
    files.push({ type: f.type, data: Buffer.from(await f.arrayBuffer()) });
  }
  if (total > MAX_TOTAL_BYTES) return fail(400, "Those photos are too big together.");

  const { data: existing } = await supabase.from("receipts").select("id, status").eq("session_id", sessionId).maybeSingle();
  if (existing?.status === "final") return fail(409, "The bill was already sent. Take it back first to rescan.");

  // Daily scan limit (each scan is a paid AI call). Checked and recorded in one
  // step, before any photo is saved or sent to the AI. Admins aren't limited.
  const { error: limitError } = await supabase.rpc("claim_receipt_scan", { p_session_id: sessionId });
  if (limitError) {
    if (limitError.code === "OT429") return fail(429, limitError.message);
    console.error("[receipt-scan] limit check failed", limitError.message);
    return fail(503, "Couldn't start scanning right now. Try again, or type the receipt in instead.");
  }

  // Keep the photos (private: only people at this table can see them).
  const paths: string[] = [];
  for (const f of files) {
    const path = `${sessionId}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from("receipts").upload(path, f.data, { contentType: f.type });
    if (error) return fail(400, `Couldn't save the photo: ${error.message}`);
    paths.push(path);
  }

  let receiptId = existing?.id as string | undefined;
  if (receiptId) {
    // Rescan replaces the old lines.
    await supabase.from("receipt_lines").delete().eq("receipt_id", receiptId);
    const { error } = await supabase
      .from("receipts")
      .update({ status: "scanning", image_paths: paths, error: null, updated_at: new Date().toISOString() })
      .eq("id", receiptId);
    if (error) return fail(400, error.message);
  } else {
    const { data, error } = await supabase
      .from("receipts")
      .insert({ session_id: sessionId, status: "scanning", image_paths: paths })
      .select("id")
      .single();
    if (error || !data) return fail(400, error?.message ?? "Couldn't start scanning.");
    receiptId = data.id as string;
  }

  const id = receiptId;
  after(async () => {
    try {
      const ai = await extractReceipt(fileBlocks(files));
      const rows = toReceiptRows(ai);
      if (!rows.lines.length) throw new Error("No items could be read from that photo. Try a clearer photo, or type it in.");

      const { data: inserted, error: lineError } = await supabase
        .from("receipt_lines")
        .insert(rows.lines.map((l, i) => ({ ...l, receipt_id: id, session_id: sessionId, sort_order: i })))
        .select("id, description, quantity, sort_order");
      if (lineError || !inserted) throw new Error(lineError?.message ?? "Couldn't save the receipt lines.");

      // Pre-match lines to what people ordered; the host checks these.
      const { data: items } = await supabase.from("order_items").select("*").eq("session_id", sessionId);
      const ordered = [...inserted].sort((a, b) => a.sort_order - b.sort_order);
      const matches = suggestMatches(ordered, (items ?? []) as OrderItem[]);
      const links = ordered.flatMap((l, i) =>
        matches[i].map((itemId) => ({ receipt_line_id: l.id, order_item_id: itemId, session_id: sessionId })),
      );
      if (links.length) await supabase.from("receipt_line_items").insert(links);

      await supabase
        .from("receipts")
        .update({
          status: "review",
          service_charge_centavos: rows.service_charge_centavos,
          tax_centavos: rows.tax_centavos,
          discount_centavos: rows.discount_centavos,
          tip_centavos: rows.tip_centavos,
          printed_total_centavos: rows.printed_total_centavos,
          ai_output: { ...ai, warnings: rows.warnings },
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      console.error("[receipt-scan] failed", id, message);
      await supabase
        .from("receipts")
        .update({ status: "failed", error: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", id);
    }
  });

  return Response.json({ receiptId: id });
}
