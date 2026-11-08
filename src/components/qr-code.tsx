"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A QR code for `value`, drawn dark-on-white so phone cameras read it in any theme. */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className="mx-auto flex items-center justify-center rounded-xl bg-white p-3"
      style={{ width: size + 24, height: size + 24 }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise
        <img src={src} width={size} height={size} alt={label} />
      ) : (
        <span className="text-sm text-zinc-500">Making QR code…</span>
      )}
    </div>
  );
}
