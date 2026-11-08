"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Chip, Input, Label, Notice } from "@/components/ui";
import { resizeImage } from "@/lib/photos";
import { friendlyError, getSupabase } from "@/lib/supabase/client";

/** POST to the import route; returns the new job id. */
async function startImport(form: FormData): Promise<string> {
  const res = await fetch("/api/admin/menu-import", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
  if (!res.ok || !body.jobId) throw new Error(body.error || `Import failed (error ${res.status}).`);
  return body.jobId;
}

/** Admin home: type a store name, AI searches the web for its menu. */
export function AiAddStoreCard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("kind", "add_store");
      form.set("name", name.trim());
      form.set("branch", branch.trim());
      router.push(`/admin/imports/${await startImport(form)}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">✨ AI add store</h2>
          <p className="text-sm text-ink-soft">
            Type a store&apos;s name. AI searches the web for its menu and prepares a draft for you to review. Nothing goes
            live until you publish.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="ai-name">Store name</Label>
            <Input id="ai-name" required maxLength={80} placeholder="e.g. Mary Grace Café" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label htmlFor="ai-branch">Branch or city (optional)</Label>
            <Input id="ai-branch" maxLength={80} placeholder="e.g. Makati" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Starting…" : "Find menu"}</Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Card>
  );
}

/** Store editor: import from a link, or from photos / a PDF of a printed menu. */
export function AiImportCard({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "files">("url");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("storeId", storeId);
      if (mode === "url") {
        form.set("kind", "import_url");
        form.set("url", url.trim());
      } else {
        form.set("kind", "import_file");
        for (const f of files) {
          if (f.type === "application/pdf") {
            form.append("files", f);
          } else {
            // Shrink phone photos but keep menu text sharp.
            const blob = await resizeImage(f, 2000, 0.85);
            form.append("files", new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
          }
        }
      }
      router.push(`/admin/imports/${await startImport(form)}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">✨ Import menu with AI</h2>
        <p className="text-sm text-ink-soft">
          AI reads the menu and shows you a draft to check. Imported prices are marked &quot;estimated&quot; until you
          confirm them.
        </p>
      </div>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Chip selected={mode === "url"} onClick={() => setMode("url")}>From a link</Chip>
            <Chip selected={mode === "files"} onClick={() => setMode("files")}>Photos or PDF</Chip>
          </div>
          {mode === "url" ? (
            <div>
              <Label htmlFor="imp-url">Menu link</Label>
              <Input id="imp-url" required inputMode="url" placeholder="https://… (website, PDF, or image)" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="imp-files">Menu pages (up to 8 photos or PDFs)</Label>
              <input
                id="imp-files"
                type="file"
                required
                multiple
                accept="image/*,application/pdf"
                className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-xl file:border file:border-line file:bg-surface file:px-3"
                onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 8))}
              />
              {files.length > 0 && <p className="mt-1 text-xs text-ink-soft">{files.length} file(s) selected</p>}
            </div>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <div>
            <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Read menu"}</Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  input: { name?: string; url?: string; files?: string[] };
  store_id: string | null;
  created_at: string;
}

const STATUS_TEXT: Record<string, string> = {
  running: "Reading…",
  ready: "Ready to review",
  failed: "Failed",
  applied: "Added",
};

/** Admin home: the last few AI imports, so a job is never lost. */
export function RecentImports() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  useEffect(() => {
    getSupabase()
      .from("menu_import_jobs")
      .select("id, kind, status, input, store_id, created_at")
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setJobs((data as JobRow[]) ?? []));
  }, []);
  if (!jobs.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Recent AI imports</h2>
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
        {jobs.map((j) => (
          <li key={j.id}>
            <Link href={`/admin/imports/${j.id}`} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 active:bg-muted">
              <span className="min-w-0 truncate text-sm">
                {j.kind === "add_store" ? `Add store: ${j.input.name}` : j.kind === "import_url" ? `Link: ${j.input.url}` : `${j.input.files?.length ?? 0} file(s)`}
              </span>
              <span className={`shrink-0 text-xs font-semibold ${j.status === "failed" ? "text-danger" : j.status === "ready" ? "text-brand" : "text-ink-soft"}`}>
                {STATUS_TEXT[j.status] ?? j.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
