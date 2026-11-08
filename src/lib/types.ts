// Row shapes returned by Supabase (see supabase/migrations).

export type SessionStatus = "open" | "closed" | "billing" | "settled";

export interface Session {
  id: string;
  host_id: string;
  title: string;
  join_code: string;
  status: SessionStatus;
  order_cutoff_at: string | null;
  currency: string;
  service_charge_bps: number;
  closed_at: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  session_id: string;
  user_id: string | null;
  display_name: string;
  is_host: boolean;
  joined_at: string;
}

export interface OrderItem {
  id: string;
  session_id: string;
  added_by: string;
  name: string;
  unit_price_centavos: number | null;
  quantity: number;
  notes: string;
  is_shared: boolean;
  created_at: string;
}

export interface Assignee {
  order_item_id: string;
  participant_id: string;
  session_id: string;
  share_weight: number;
}

export interface DeliveryEvent {
  id: number;
  order_item_id: string;
  session_id: string;
  delta: 1 | -1;
  by_participant_id: string | null;
  created_at: string;
}
