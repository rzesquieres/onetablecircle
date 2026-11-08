import { after, type NextRequest } from "next/server";
import { aiConfigured, extractMenu, researchStoreMenu } from "@/lib/ai/claude";
import type { ImportResult } from "@/lib/ai/menu-draft";
import { fetchMenuSource, fileBlocks } from "@/lib/ai/source";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";

const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const FILE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * Start an AI menu job. Returns { jobId } straight away; the AI work runs
 * after the response (it can take a few minutes) and writes its result to
 * menu_import_jobs, which the review page polls.
 *
 * Form fields: kind = add_store | import_url | import_file,
 *   add_store: name, branch?   import_url: storeId, url   import_file: storeId, files[]
 */
export async function POST(request: NextRequest) {
  if (!supabaseConfigured) return fail(503, "The app isn't connected to its database yet.");
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail(401, "Please sign in again.");
  if (!aiConfigured()) {
    return fail(503, "AI import isn't set up yet: add ANTHROPIC_API_KEY in Hostinger's environment variables.");
  }

  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  const storeId = String(form.get("storeId") ?? "") || null;
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const branch = String(form.get("branch") ?? "").trim().slice(0, 80);
  const url = String(form.get("url") ?? "").trim();

  // Admins (and later, owners of this store) only. The database checks this too.
  const { data: allowed } = await supabase.rpc("can_manage_import", { p_store_id: storeId });
  if (!allowed) return fail(403, "Only admins can import menus.");

  const files: { name: string; type: string; data: Buffer }[] = [];
  if (kind === "add_store") {
    if (!name) return fail(400, "Type the store's name.");
  } else if (kind === "import_url") {
    if (!storeId || !/^https?:\/\//i.test(url)) return fail(400, "Paste a link that starts with http:// or https://.");
  } else if (kind === "import_file") {
    if (!storeId) return fail(400, "Missing store.");
    const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!uploads.length) return fail(400, "Add at least one photo or PDF.");
    if (uploads.length > MAX_FILES) return fail(400, `Up to ${MAX_FILES} files at a time.`);
    let total = 0;
    for (const f of uploads) {
      if (!FILE_TYPES.has(f.type)) return fail(400, `${f.name}: only photos (JPG, PNG, WebP) and PDFs are supported.`);
      total += f.size;
      files.push({ name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) });
    }
    if (total > MAX_TOTAL_BYTES) return fail(400, "Those files are too big together (over 20 MB). Try fewer pages.");
  } else {
    return fail(400, "Unknown import type.");
  }

  const { data: job, error } = await supabase
    .from("menu_import_jobs")
    .insert({
      store_id: kind === "add_store" ? null : storeId,
      kind,
      input: { name, branch, url, files: files.map((f) => f.name) },
    })
    .select("id")
    .single();
  if (error || !job) return fail(400, error?.message ?? "Couldn't start the import.");

  after(async () => {
    const finish = (patch: Record<string, unknown>) =>
      supabase
        .from("menu_import_jobs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", job.id);
    try {
      let result: ImportResult;
      if (kind === "add_store") {
        const research = await researchStoreMenu(name, branch);
        const menu = await extractMenu([{ type: "text", text: research.text }], `Menu found online for ${name}${branch ? ` (${branch})` : ""}.`);
        result = { menu, sources: research.sources, warnings: menu.warnings };
      } else if (kind === "import_url") {
        const source = await fetchMenuSource(url);
        const menu = await extractMenu(source.blocks, `Menu from ${url}`);
        result = { menu, sources: [url], warnings: [...source.warnings, ...menu.warnings] };
      } else {
        const menu = await extractMenu(fileBlocks(files), `${files.length} uploaded photo(s)/PDF(s) of a printed menu.`);
        result = { menu, sources: [], warnings: menu.warnings };
      }
      const { error: saveError } = await finish({ status: "ready", result });
      if (saveError) console.error("[menu-import] could not save result", job.id, saveError.message);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      console.error("[menu-import] failed", job.id, message);
      await finish({ status: "failed", error: message.slice(0, 500) });
    }
  });

  return Response.json({ jobId: job.id });
}
