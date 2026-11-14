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
  store_id: string | null;
}

export interface Participant {
  id: string;
  session_id: string;
  user_id: string | null;
  display_name: string;
  is_host: boolean;
  joined_at: string;
  /** Who added this person by name (people without a phone); null for people who joined themselves. */
  added_by: string | null;
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
  menu_item_id: string | null;
  /** Snapshot of chosen options at order time. */
  options: OrderOption[];
  price_is_estimate: boolean;
}

export interface OrderOption {
  group: string;
  option: string;
  price_delta_centavos: number;
}

export interface Assignee {
  order_item_id: string;
  participant_id: string;
  session_id: string;
  share_weight: number;
}

export type StoreStatus = "draft" | "published" | "archived";

export interface Store {
  id: string;
  org_id: string;
  name: string;
  branch: string;
  status: StoreStatus;
  currency: string;
  vat_inclusive: boolean;
  default_service_charge_bps: number;
  source_url: string | null;
  menu_updated_at: string;
  /** true = show categories in the admin's own order; false = diner-friendly order (OTC-24). */
  custom_category_order: boolean;
  created_at: string;
}

export interface MenuCategory {
  id: string;
  store_id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  store_id: string;
  category_id: string;
  name: string;
  description: string;
  base_price_centavos: number;
  price_status: "estimated" | "confirmed";
  photo_path: string | null;
  is_available: boolean;
  sort_order: number;
}

export interface OptionGroup {
  id: string;
  store_id: string;
  name: string;
  selection: "single" | "multi";
  min_select: number;
  max_select: number | null;
  sort_order: number;
}

export interface MenuOption {
  id: string;
  store_id: string;
  option_group_id: string;
  name: string;
  price_delta_centavos: number;
  is_default: boolean;
  sort_order: number;
}

export interface ItemGroupLink {
  menu_item_id: string;
  option_group_id: string;
  store_id: string;
  sort_order: number;
}

export interface Menu {
  store: Store;
  categories: MenuCategory[];
  items: MenuItem[];
  groups: OptionGroup[];
  options: MenuOption[];
  links: ItemGroupLink[];
}

export type ReceiptStatus = "scanning" | "review" | "failed" | "final";
export type LineSplit = "items" | "people" | "everyone";

export interface Receipt {
  id: string;
  session_id: string;
  status: ReceiptStatus;
  image_paths: string[];
  service_charge_centavos: number;
  tax_centavos: number;
  discount_centavos: number;
  tip_centavos: number;
  printed_total_centavos: number | null;
  ai_output: { merchant?: string | null; warnings?: string[] } | null;
  error: string | null;
  payment_qr_path: string | null;
  payment_qr_label: string;
  finalized_at: string | null;
}

export interface ReceiptLine {
  id: string;
  receipt_id: string;
  session_id: string;
  description: string;
  quantity: number;
  amount_centavos: number;
  split: LineSplit;
  sort_order: number;
}

export interface ReceiptLineItem {
  receipt_line_id: string;
  order_item_id: string;
  session_id: string;
}

export interface ReceiptLinePerson {
  receipt_line_id: string;
  participant_id: string;
  session_id: string;
  weight: number;
}

export interface BillShareRow {
  session_id: string;
  participant_id: string;
  items_centavos: number;
  service_centavos: number;
  tax_centavos: number;
  discount_centavos: number;
  tip_centavos: number;
  total_centavos: number;
  breakdown: { lineId: string; description: string; amount: number; note: string }[];
}

export interface Payment {
  session_id: string;
  participant_id: string;
  marked_paid_at: string | null;
  confirmed_at: string | null;
}

export interface DeliveryEvent {
  id: number;
  order_item_id: string;
  session_id: string;
  delta: 1 | -1;
  by_participant_id: string | null;
  created_at: string;
}
