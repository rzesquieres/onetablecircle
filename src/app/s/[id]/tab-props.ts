import type { ConsolidatedLine } from "@/lib/consolidate";
import type { Participant } from "@/lib/types";
import type { TableData } from "./use-table";

export interface TabProps {
  data: TableData;
  me: Participant;
  isHost: boolean;
  lines: ConsolidatedLine[];
  now: Date;
  ordersOpen: boolean;
  reload: () => Promise<void>;
}

export function nameOf(data: TableData, participantId: string | null | undefined): string {
  return data.participants.find((p) => p.id === participantId)?.display_name ?? "Someone";
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}
