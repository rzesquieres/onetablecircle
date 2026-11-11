"use client";

import { useState } from "react";
import { Button, Chip, Input, Label, Notice } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import type { Participant } from "@/lib/types";

/** State for "who is this item for": one person, or shared between several. */
export function useForWhom(people: Participant[], meId: string) {
  const [shared, setShared] = useState(false);
  const [forIds, setForIds] = useState<string[]>([meId]);

  return {
    shared,
    forIds,
    pick(pid: string) {
      if (!shared) return setForIds([pid]);
      setForIds((ids) => (ids.includes(pid) ? ids.filter((x) => x !== pid) : [...ids, pid]));
    },
    toggleShared() {
      const next = !shared;
      setShared(next);
      setForIds(next ? people.map((p) => p.id) : [meId]);
    },
    reset() {
      setShared(false);
      setForIds([meId]);
    },
  };
}

export type ForWhomState = ReturnType<typeof useForWhom>;

export function ForWhom({
  state,
  people,
  meId,
  sessionId,
  onPersonAdded,
}: {
  state: ForWhomState;
  people: Participant[];
  meId: string;
  sessionId: string;
  onPersonAdded?: () => void;
}) {
  // Someone just added here may not be in `people` until the table reloads.
  const [pending, setPending] = useState<Participant[]>([]);
  const shown = [...people, ...pending.filter((p) => !people.some((x) => x.id === p.id))];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label>{state.shared ? "Shared by" : "For"}</Label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-brand" checked={state.shared} onChange={state.toggleShared} />
          Shared item
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map((p) => (
          <Chip key={p.id} selected={state.forIds.includes(p.id)} onClick={() => state.pick(p.id)}>
            {p.id === meId ? "Me" : p.display_name}
          </Chip>
        ))}
        <AddSomeoneChip
          sessionId={sessionId}
          onAdded={(person) => {
            setPending((list) => [...list, person]);
            state.pick(person.id);
            onPersonAdded?.();
          }}
        />
      </div>
      {state.shared && (
        <p className="mt-1 text-xs text-ink-soft">
          Split evenly between {state.forIds.length} {state.forIds.length === 1 ? "person" : "people"}.
        </p>
      )}
    </div>
  );
}

/**
 * "+ Someone else": add a person without a phone right from the order form.
 * Not a <form>, because it sits inside the order form; Enter adds the person instead of submitting the order.
 */
function AddSomeoneChip({ sessionId, onAdded }: { sessionId: string; onAdded: (person: Participant) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    const { data, error } = await getSupabase().rpc("add_offline_person", {
      p_session_id: sessionId,
      p_display_name: trimmed,
    });
    setBusy(false);
    if (error || typeof data !== "string") return setError(friendlyError(error ?? "Couldn't add them. Try again."));
    onAdded({
      id: data,
      session_id: sessionId,
      user_id: null,
      display_name: trimmed.slice(0, 40),
      is_host: false,
      joined_at: new Date().toISOString(),
      added_by: null,
    });
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <Chip selected={false} onClick={() => setOpen(true)} className="border-dashed text-ink-soft">
        + Someone else
      </Chip>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex gap-2">
        <Input
          autoFocus
          aria-label="Name of someone without a phone"
          placeholder="Their name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add} disabled={busy || !name.trim()}>
          {busy ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="ghost" aria-label="Cancel" className="px-3" onClick={() => setOpen(false)}>
          ✕
        </Button>
      </div>
      <p className="text-xs text-ink-soft">For someone without a phone. They&apos;ll show up for everyone at the table.</p>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

export function QtyStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex h-12 items-center rounded-xl border border-line bg-surface">
      <button type="button" aria-label="Less" className="h-full w-11 text-xl" onClick={() => onChange(Math.max(1, value - 1))}>
        −
      </button>
      <span className="w-7 text-center font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label="More" className="h-full w-11 text-xl" onClick={() => onChange(Math.min(99, value + 1))}>
        +
      </button>
    </div>
  );
}
