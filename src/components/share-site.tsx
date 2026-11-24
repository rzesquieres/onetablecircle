"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui";
import { displaySiteUrl, SHARE_TEXT, SHARE_TITLE, siteShareUrl } from "@/lib/share";

const noSubscribe = () => () => {};

/** This site's address: NEXT_PUBLIC_SITE_URL, else the current origin. Empty while rendering on the server. */
function useSiteOrigin(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin,
    () => "",
  );
}

/** Full-screen QR code, so a friend across the table can scan it. Tap anywhere or press Esc to close. */
function QrFullScreen({ value, onClose }: { value: string; onClose: () => void }) {
  const [size] = useState(() => Math.min(window.innerWidth, window.innerHeight, 560) - 96);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="QR code to OneTableCircle"
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-6"
    >
      <QrCode value={value} size={size} label="QR code to the OneTableCircle website" />
      <p className="text-center text-white">Scan with your phone camera to open OneTableCircle</p>
      <button
        type="button"
        onClick={onClose}
        className="min-h-12 rounded-xl border border-white/40 px-6 font-semibold text-white active:bg-white/10"
      >
        Close
      </button>
    </div>
  );
}

/**
 * QR code and share button for the OneTableCircle website, for inviting
 * friends. The share button opens the phone's share sheet; where that isn't
 * available (most desktops) it copies the link instead.
 */
export function ShareSite({ size = 180 }: { size?: number }) {
  const origin = useSiteOrigin();
  const [enlarged, setEnlarged] = useState(false);
  const [status, setStatus] = useState<"" | "copied" | "failed">("");
  const close = useCallback(() => setEnlarged(false), []);

  if (!origin) return null;
  const qrUrl = siteShareUrl(origin, "qr");
  const shareUrl = siteShareUrl(origin, "share");

  async function share() {
    setStatus("");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: shareUrl });
        return;
      } catch (e) {
        // The person closed the share sheet: nothing to do.
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Otherwise sharing failed; fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("copied");
      setTimeout(() => setStatus(""), 2500);
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        aria-label="Show the QR code full screen"
        className="rounded-2xl active:opacity-80"
      >
        <QrCode value={qrUrl} size={size} label="QR code to the OneTableCircle website" />
      </button>
      <p className="text-xs text-ink-soft">Tap the code to make it bigger</p>
      <Button onClick={share} className="w-full max-w-xs">
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        {status === "copied" ? "Link copied ✓" : "Share OneTableCircle"}
      </Button>
      <p className="font-mono text-sm text-ink-soft" aria-live="polite">
        {status === "failed" ? `Copy this link: ${displaySiteUrl(origin)}` : displaySiteUrl(origin)}
      </p>
      {enlarged && <QrFullScreen value={qrUrl} onClose={close} />}
    </div>
  );
}
