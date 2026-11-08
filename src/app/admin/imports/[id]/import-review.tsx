"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import {
  countIncluded,
  draftProblems,
  toApplyPayload,
  toDraft,
  type Draft,
  type DraftCategory,
  type DraftGroup,
  type ImportResult,
} from "@/lib/ai/menu-draft";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { AdminGate } from "../../admin-gate";

interface Job {
  id: string;
  kind: "add_store" | "import_url" | "import_file";
  status: "running" | "ready" | "failed" | "applied";
  input: { name?: string; branch?: string; url?: string; files?: string[] };
  result: ImportResult | null;
  error: string | null;
  store_id: string | null;
  created_at: string;
}

export function ImportReview() {
  return (
    <AdminGate>
      <Review />
    </AdminGate>
  );
}

function Review() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [storeName, setStoreName] = useState("");
  const [existing, setExisting] = useState<string[] | null>(null);

  // Poll while the AI is working.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const { data } = await getSupabase().from("menu_import_jobs").select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      setJob((data as Job) ?? null);
      if (data?.status === "running") timer = setTimeout(tick, 4000);
    }
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  // For imports into an existing store: its name, and item names (to spot duplicates).
  const storeId = job?.store_id ?? null;
  const isReady = job?.status === "ready";
  useEffect(() => {
    if (!storeId || !isReady) return;
    const supabase = getSupabase();
    Promise.all([
      supabase.from("stores").select("name, branch").eq("id", storeId).maybeSingle(),
      supabase.from("menu_items").select("name").eq("store_id", storeId),
    ]).then(([s, i]) => {
      setStoreName([s.data?.name, s.data?.branch].filter(Boolean).join(" · "));
      setExisting((i.data ?? []).map((r) => r.name as string));
    });
  }, [storeId, isReady]);

  if (job === undefined) return <Spinner />;
  if (!job) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="error">Import not found.</Notice>
        <Link href="/admin" className="text-brand">Back to admin</Link>
      </div>
    );
  }

  const title =
    job.kind === "add_store"
      ? `AI add store: ${job.input.name}${job.input.branch ? ` (${job.input.branch})` : ""}`
      : job.kind === "import_url"
        ? "Import from link"
        : `Import from ${job.input.files?.length ?? 0} file(s)`;
  const back = job.store_id ? `/admin/stores/${job.store_id}` : "/admin";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={back} className="text-sm text-ink-soft">← Back</Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {job.kind === "import_url" && <p className="break-all text-sm text-ink-soft">{job.input.url}</p>}
        {storeName && <p className="text-sm text-ink-soft">Into: {storeName}</p>}
      </div>

      {job.status === "running" && (
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="size-8 animate-spin rounded-full border-4 border-line border-t-brand" aria-hidden />
          <p className="font-medium">{job.kind === "add_store" ? "Searching the web and reading the menu…" : "Reading the menu…"}</p>
          <p className="text-sm text-ink-soft">This usually takes 1–3 minutes. You can leave this page and come back from Admin → Recent AI imports.</p>
        </Card>
      )}

      {job.status === "failed" && (
        <div className="flex flex-col gap-3">
          <Notice tone="error">{job.error || "The import failed."}</Notice>
          <Link href={back} className="text-brand">Try again</Link>
        </div>
      )}

      {job.status === "applied" && (
        <div className="flex flex-col gap-3">
          <Notice>This import has already been added.</Notice>
          {job.store_id && <Link href={`/admin/stores/${job.store_id}`} className="text-brand">Open the store</Link>}
        </div>
      )}

      {job.status === "ready" && job.result && (job.store_id === null || existing !== null) && (
        <DraftEditor
          job={job}
          initial={toDraft(job.result, {
            existingItemNames: existing ?? [],
            storeName: job.kind === "add_store" ? job.input.name : undefined,
            branch: job.kind === "add_store" ? job.input.branch : undefined,
          })}
        />
      )}
    </div>
  );
}

function DraftEditor({ job, initial }: { job: Job; initial: Draft }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  const problems = draftProblems(draft);
  const included = countIncluded(draft);
  const warnings = job.result?.warnings ?? [];
  const sources = job.result?.sources ?? [];

  const update = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      const copy: Draft = structuredClone(d);
      fn(copy);
      return copy;
    });

  async function apply() {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError("");
    const { data, error } = await getSupabase().rpc("apply_menu_import", {
      p_job_id: job.id,
      p_menu: toApplyPayload(draft),
    });
    if (error) {
      setError(friendlyError(error));
      setBusy(false);
      return;
    }
    router.push(`/admin/stores/${data}`);
  }

  if (!draft.categories.length) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warn">The AI didn&apos;t find any menu items.{warnings.length ? ` It said: ${warnings.join(" ")}` : ""}</Notice>
        <Link href={job.store_id ? `/admin/stores/${job.store_id}` : "/admin"} className="text-brand">Try a different source</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <Notice>
        Check this against the real menu. Untick anything wrong, fix names and prices, then add it. All prices will be
        marked &quot;estimated&quot; until you confirm them in the store editor.
      </Notice>

      {(warnings.length > 0 || sources.length > 0) && (
        <Card className="flex flex-col gap-2 text-sm">
          {warnings.length > 0 && (
            <div>
              <p className="font-semibold">Notes from the AI</p>
              <ul className="list-disc pl-5 text-ink-soft">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          {sources.length > 0 && (
            <div>
              <p className="font-semibold">Sources</p>
              <ul className="flex flex-col gap-1">
                {sources.map((s) => (
                  <li key={s}>
                    <a href={s} target="_blank" rel="noopener noreferrer" className="break-all text-brand underline">{s}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {job.kind === "add_store" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">New store (saved as a draft)</h2>
          <Card className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input maxLength={80} value={draft.storeName} onChange={(e) => update((d) => { d.storeName = e.target.value; })} />
            </div>
            <div>
              <Label>Branch</Label>
              <Input maxLength={80} value={draft.branch} onChange={(e) => update((d) => { d.branch = e.target.value; })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Source link (saved on the store)</Label>
              <Input inputMode="url" value={draft.sourceUrl} onChange={(e) => update((d) => { d.sourceUrl = e.target.value; })} />
            </div>
          </Card>
        </section>
      )}

      {draft.groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Options ({draft.groups.filter((g) => g.include).length})</h2>
          {draft.groups.map((g, gi) => (
            <GroupDraft key={gi} group={g} onChange={(fn) => update((d) => fn(d.groups[gi]))} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Menu items ({included} ticked)</h2>
        {draft.categories.map((c, ci) => (
          <CategoryDraft
            key={ci}
            category={c}
            groupNames={draft.groups.filter((g) => g.include).map((g) => g.name)}
            tried={tried}
            onChange={(fn) => update((d) => fn(d.categories[ci]))}
          />
        ))}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {tried && problems.length > 0 && (
            <p className="text-sm text-danger">
              {problems[0]}
              {problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}
            </p>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button className="min-h-14 text-lg" disabled={busy || included === 0} onClick={apply}>
            {busy ? "Adding…" : job.kind === "add_store" ? `Create draft store with ${included} items` : `Add ${included} items to the menu`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GroupDraft({ group, onChange }: { group: DraftGroup; onChange: (fn: (g: DraftGroup) => void) => void }) {
  return (
    <Card className={`flex flex-col gap-3 ${group.include ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" aria-label="Include this option group" className="size-5 accent-brand" checked={group.include} onChange={(e) => onChange((g) => { g.include = e.target.checked; })} />
        <Input className="min-w-40 flex-1 font-semibold" maxLength={60} value={group.name} onChange={(e) => onChange((g) => { g.name = e.target.value; })} />
        <select
          className="min-h-12 rounded-xl border border-line bg-surface px-3"
          value={group.selection}
          onChange={(e) => onChange((g) => { g.selection = e.target.value as "single" | "multi"; })}
        >
          <option value="single">Pick one</option>
          <option value="multi">Pick several</option>
        </select>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-brand" checked={group.required} onChange={(e) => onChange((g) => { g.required = e.target.checked; })} />
          Required
        </label>
      </div>
      <ul className="flex flex-col gap-2">
        {group.options.map((o, oi) => (
          <li key={oi} className="flex items-center gap-2">
            <Input className="flex-1" maxLength={60} value={o.name} onChange={(e) => onChange((g) => { g.options[oi].name = e.target.value; })} />
            <span className="text-sm text-ink-soft">+₱</span>
            <Input className="w-24" inputMode="decimal" value={o.price} onChange={(e) => onChange((g) => { g.options[oi].price = e.target.value; })} />
            <Button variant="ghost" className="min-h-11 px-3" aria-label="Remove choice" onClick={() => onChange((g) => { g.options.splice(oi, 1); })}>✕</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CategoryDraft({
  category,
  groupNames,
  tried,
  onChange,
}: {
  category: DraftCategory;
  groupNames: string[];
  tried: boolean;
  onChange: (fn: (c: DraftCategory) => void) => void;
}) {
  const live = new Set(groupNames.map((n) => n.toLowerCase()));
  return (
    <Card className={`flex flex-col gap-3 ${category.include ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <input type="checkbox" aria-label="Include this category" className="size-5 accent-brand" checked={category.include} onChange={(e) => onChange((c) => { c.include = e.target.checked; })} />
        <Input className="flex-1 font-semibold" maxLength={60} value={category.name} onChange={(e) => onChange((c) => { c.name = e.target.value; })} />
        <Button
          variant="ghost"
          className="min-h-11 px-3 text-sm"
          onClick={() => onChange((c) => { const all = c.items.every((i) => i.include); c.items.forEach((i) => { i.include = !all; }); })}
        >
          {category.items.every((i) => i.include) ? "Untick all" : "Tick all"}
        </Button>
      </div>
      {category.include && (
        <ul className="flex flex-col divide-y divide-line">
          {category.items.map((item, ii) => {
            const missing = item.include && !item.price.trim();
            return (
              <li key={ii} className={`flex flex-col gap-2 py-3 ${item.include ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" aria-label={`Include ${item.name}`} className="size-5 accent-brand" checked={item.include} onChange={(e) => onChange((c) => { c.items[ii].include = e.target.checked; })} />
                  <Input className="min-w-40 flex-1" maxLength={120} value={item.name} onChange={(e) => onChange((c) => { c.items[ii].name = e.target.value; })} />
                  <span className="text-sm text-ink-soft">₱</span>
                  <Input
                    className={`w-28 ${missing && tried ? "border-danger" : ""}`}
                    inputMode="decimal"
                    placeholder={missing ? "Price?" : ""}
                    value={item.price}
                    onChange={(e) => onChange((c) => { c.items[ii].price = e.target.value; })}
                  />
                </div>
                <Input
                  className="text-sm"
                  maxLength={500}
                  placeholder="Description (optional)"
                  value={item.description}
                  onChange={(e) => onChange((c) => { c.items[ii].description = e.target.value; })}
                />
                <p className="text-xs text-ink-soft">
                  {item.duplicate && <span className="font-semibold text-warn">Already on the menu · </span>}
                  {missing && <span className="font-semibold text-warn">No price on the menu · </span>}
                  {item.groups.filter((g) => live.has(g.toLowerCase())).length
                    ? `Options: ${item.groups.filter((g) => live.has(g.toLowerCase())).join(", ")}`
                    : "No options"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
