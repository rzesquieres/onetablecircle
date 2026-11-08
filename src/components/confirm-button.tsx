"use client";

import { useState } from "react";
import { Button } from "./ui";

/**
 * Two-tap destructive button (no browser pop-up): the first tap asks
 * "Delete X?" with Keep / Delete, the second tap runs `onConfirm`.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  onConfirm,
  disabled,
  small,
}: {
  label: string;
  confirmLabel: string;
  question?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  small?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const size = small ? "min-h-9 px-2 text-sm" : "";

  if (!armed) {
    return (
      <Button variant="danger" className={size} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {question && <span className="text-sm text-ink-soft">{question}</span>}
      <Button variant="ghost" className={size} onClick={() => setArmed(false)} disabled={busy}>
        Keep
      </Button>
      <Button
        className={`bg-danger active:bg-danger ${size}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {busy ? "…" : confirmLabel}
      </Button>
    </span>
  );
}
