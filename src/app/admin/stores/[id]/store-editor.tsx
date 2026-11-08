"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { fetchMenu } from "@/lib/use-menu";
import { deleteMenuPhoto } from "@/lib/photos";
import type { Menu, StoreStatus } from "@/lib/types";
import { AdminGate, STATUS_STYLE } from "../../admin-gate";
import type { EditorProps } from "./editor-context";
import { OptionGroupsEditor } from "./option-groups-editor";
import { MenuSectionsEditor } from "./menu-sections-editor";

export function StoreEditor() {
  return (
    <AdminGate>
      <Editor />
    </AdminGate>
  );
}

function Editor() {
  const { id } = useParams<{ id: string }>();
  const [menu, setMenu] = useState<Menu | null | undefined>(undefined);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setMenu(await fetchMenu(id));
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchMenu(id)
      .then((m) => !cancelled && setMenu(m))
      .catch((e) => !cancelled && setError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const act = useCallback(
    async (action: PromiseLike<{ error: unknown }>) => {
      setError("");
      const { error } = await action;
      if (error) setError(friendlyError(error));
      await reload();
      return !error;
    },
    [reload],
  );

  if (menu === undefined && !error) return <Spinner />;
  if (!menu) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="error">{error || "Store not found."}</Notice>
        <Link href="/admin" className="text-brand">All stores</Link>
      </div>
    );
  }

  const props: EditorProps = { menu, act, reload };
  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin" className="text-sm text-ink-soft">← All stores</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {menu.store.name}
            {menu.store.branch && <span className="text-ink-soft"> · {menu.store.branch}</span>}
          </h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[menu.store.status]}`}>
            {menu.store.status}
          </span>
        </div>
        <p className="text-sm text-ink-soft">
          {menu.items.length} items · {menu.categories.length} categories · menu updated{" "}
          {new Date(menu.store.menu_updated_at).toLocaleString("en-PH")}
        </p>
      </div>

      {error && (
        <div className="sticky top-2 z-20">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <DetailsSection {...props} />
      <MenuSectionsEditor {...props} />
      <OptionGroupsEditor {...props} />
      <DangerZone {...props} />
    </div>
  );
}

function DetailsSection({ menu, act }: EditorProps) {
  const s = menu.store;
  const [name, setName] = useState(s.name);
  const [branch, setBranch] = useState(s.branch);
  const [sc, setSc] = useState(String(s.default_service_charge_bps / 100));
  const [vat, setVat] = useState(s.vat_inclusive);
  const [source, setSource] = useState(s.source_url ?? "");
  const [localError, setLocalError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    const pct = Number(sc || "0");
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setLocalError("Service charge must be 0–100%.");
    if (source && !/^https?:\/\//i.test(source)) return setLocalError("Source link must start with http:// or https://");
    await act(
      getSupabase()
        .from("stores")
        .update({
          name: name.trim(),
          branch: branch.trim(),
          default_service_charge_bps: Math.round(pct * 100),
          vat_inclusive: vat,
          source_url: source.trim() || null,
        })
        .eq("id", s.id),
    );
  }

  const setStatus = (status: StoreStatus) => act(getSupabase().from("stores").update({ status }).eq("id", s.id));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Store details</h2>
      <Card>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="n">Name</Label>
            <Input id="n" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="b">Branch</Label>
            <Input id="b" maxLength={80} value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sc">Usual service charge (%)</Label>
            <Input id="sc" inputMode="decimal" value={sc} onChange={(e) => setSc(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="src">Menu source link (optional)</Label>
            <Input id="src" inputMode="url" placeholder="https://…" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-5 accent-brand" checked={vat} onChange={(e) => setVat(e.target.checked)} />
            Menu prices already include VAT
          </label>
          {localError && <div className="sm:col-span-2"><Notice tone="error">{localError}</Notice></div>}
          <div className="sm:col-span-2">
            <Button type="submit">Save details</Button>
          </div>
        </form>
      </Card>
      <Card className="flex flex-wrap items-center gap-3">
        {s.status === "published" ? (
          <>
            <p className="flex-1 text-sm">Published: hosts can pick this store and everyone sees its menu.</p>
            <Button variant="secondary" onClick={() => setStatus("draft")}>Unpublish</Button>
          </>
        ) : (
          <>
            <p className="flex-1 text-sm">
              {s.status === "draft" ? "Draft: only admins can see it." : "Archived: hidden from everyone but admins."}
            </p>
            <Button onClick={() => setStatus("published")} disabled={menu.items.length === 0}>
              Publish
            </Button>
          </>
        )}
        {s.status !== "archived" && (
          <Button variant="ghost" onClick={() => setStatus("archived")}>Archive</Button>
        )}
      </Card>
    </section>
  );
}

function DangerZone({ menu }: EditorProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">Delete store</h2>
      <p className="text-sm text-ink-soft">
        Deletes the store, its whole menu and photos. Past tables keep what people ordered.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <ConfirmButton
          label="Delete this store…"
          question={`Delete ${menu.store.name}?`}
          confirmLabel="Yes, delete"
          onConfirm={async () => {
            const { error } = await getSupabase().from("stores").delete().eq("id", menu.store.id);
            if (error) return setError(friendlyError(error));
            await Promise.all(menu.items.map((i) => deleteMenuPhoto(i.photo_path)));
            router.replace("/admin");
          }}
        />
      </div>
    </section>
  );
}
