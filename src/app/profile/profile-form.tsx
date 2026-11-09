"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui";
import { publicStorageUrl } from "@/lib/menu";
import { resizeImage } from "@/lib/photos";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/supabase/env";
import { useUser } from "@/lib/use-user";

interface Profile {
  display_name: string;
  payment_qr_path: string | null;
  payment_qr_label: string;
}

export function ProfileForm() {
  const { user, isGuest, loading } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!user) return;
    getSupabase()
      .from("profiles")
      .select("display_name, payment_qr_path, payment_qr_label")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const p = (data as Profile) ?? { display_name: "", payment_qr_path: null, payment_qr_label: "" };
        setProfile(p);
        setName(p.display_name);
        setLabel(p.payment_qr_label);
      });
  }, [user]);

  if (loading || (user && !profile)) return <Spinner />;
  if (!user || !profile) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>Sign in to edit your profile.</Notice>
        <Link href="/login?next=/profile" className="text-brand">Sign in</Link>
      </div>
    );
  }

  async function update(patch: Partial<Profile>, message: string) {
    setBusy(true);
    setError("");
    setSaved("");
    const { error } = await getSupabase().from("profiles").update(patch).eq("user_id", user!.id);
    setBusy(false);
    if (error) {
      setError(friendlyError(error));
      return false;
    }
    setProfile((p) => (p ? { ...p, ...patch } : p));
    setSaved(message);
    return true;
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    await update({ display_name: name.trim(), payment_qr_label: label.trim() }, "Saved ✓");
  }

  async function uploadQr(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const blob = await resizeImage(file, 1000, 0.92);
      const path = `${user!.id}/${crypto.randomUUID()}.jpg`;
      const storage = getSupabase().storage.from("payment-qr");
      const { error } = await storage.upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw error;
      const old = profile!.payment_qr_path;
      if (await update({ payment_qr_path: path }, "QR code saved ✓")) {
        if (old) await storage.remove([old]);
      }
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  async function removeQr() {
    const old = profile!.payment_qr_path;
    if (await update({ payment_qr_path: null }, "QR code removed")) {
      if (old) await getSupabase().storage.from("payment-qr").remove([old]);
    }
  }

  const qrUrl = publicStorageUrl(SUPABASE_URL, "payment-qr", profile.payment_qr_path);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-ink-soft">← Home</Link>
        <h1 className="text-2xl font-semibold">Your profile</h1>
        {isGuest && <p className="text-sm text-ink-soft">You&apos;re using OneTableCircle as a guest on this phone.</p>}
      </div>

      <Card>
        <form onSubmit={saveDetails} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="pname">Your name</Label>
            <Input id="pname" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1 text-xs text-ink-soft">Used when you start or join a table.</p>
          </div>
          <div>
            <Label htmlFor="plabel">Payment note (optional)</Label>
            <Input id="plabel" maxLength={60} placeholder="e.g. GCash · Ronnel E. · 0917•••1234" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>Save</Button>
        </form>
      </Card>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">GCash / Maya QR code</h2>
          <p className="text-sm text-ink-soft">
            When you host and send the bill, everyone sees this QR code to pay you. In GCash: Profile → My QR code →
            Download/screenshot, then upload it here.
          </p>
        </div>
        <Card className="flex flex-col items-center gap-3">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- your own QR image
            <img src={qrUrl} alt="Your payment QR code" className="w-56 max-w-full rounded-xl bg-white p-2" />
          ) : (
            <p className="py-6 text-sm text-ink-soft">No QR code yet.</p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <label className={`inline-flex min-h-12 cursor-pointer items-center rounded-xl bg-brand px-4 font-semibold text-white ${busy ? "opacity-50" : ""}`}>
              {qrUrl ? "Replace QR code" : "Upload QR code"}
              <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => uploadQr(e.target.files?.[0])} />
            </label>
            {qrUrl && (
              <Button variant="ghost" disabled={busy} onClick={removeQr}>Remove</Button>
            )}
          </div>
          <p className="text-center text-xs text-ink-soft">
            Shown to people at tables you host. The image has an unguessable web link, so only people who are given it can open
            it. The app never handles money.
          </p>
        </Card>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
    </div>
  );
}
