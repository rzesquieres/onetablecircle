"use client";

import { useState } from "react";
import { Chip, Label } from "@/components/ui";
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

export function ForWhom({ state, people, meId }: { state: ForWhomState; people: Participant[]; meId: string }) {
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
        {people.map((p) => (
          <Chip key={p.id} selected={state.forIds.includes(p.id)} onClick={() => state.pick(p.id)}>
            {p.id === meId ? "Me" : p.display_name}
          </Chip>
        ))}
      </div>
      {state.shared && (
        <p className="mt-1 text-xs text-ink-soft">
          Split evenly between {state.forIds.length} {state.forIds.length === 1 ? "person" : "people"}.
        </p>
      )}
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
