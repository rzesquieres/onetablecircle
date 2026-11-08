# Architecture & data model

Status: **approved 2026-11-08** (Supabase backend; optional tip line; the host confirms payments).
Implemented so far, one migration per phase in `supabase/migrations/`:
- Phase 1: `20261108000000_phase1.sql` (sessions, ordering, delivery checklist)
- Phase 2: `20261108100000_phase2_guests.sql` (quick guests via anonymous sign-in, table preview, hosts must be real accounts)
- Phase 3: `20261109000000_phase3_menus.sql` (organizations, stores, menus, option groups, server-side menu pricing `add_menu_item()`, menu photos bucket, admin flag)

Tables for later phases (menu reports, AI import jobs, receipts, bill shares, payments, saved groups, favorites) are still a plan and get added in their own migrations. `menu_reports` moves to Phase 4, alongside AI drafts.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Web app | **Next.js 16** (App Router, TypeScript, Tailwind) | One codebase for pages and server logic. Hostinger's managed Node.js hosting auto-detects it and builds it from GitHub. |
| Hosting | **Hostinger** managed Node.js web app (Business or Cloud plan), Node 22 | Already paid for; deploys on every `git push`. |
| Auth, database, realtime, file storage | **Supabase** (Postgres) | Email + Google login and anonymous guest sign-in built in. Row-Level Security (RLS) enforces "you only see your sessions". Realtime pushes live order and checklist updates. Storage holds receipt photos, menu photos and GCash/Maya QRs. Free tier is enough to start. |
| AI | **Claude API** (vision), called only from server code | Receipt scanning and menu extraction from photos, PDFs and links. The key never reaches the browser. |
| Tests | Vitest | The pure bill-split and money logic is unit-tested. |

**Why this fits Hostinger well:** live updates go **directly from each phone to Supabase Realtime**, not through Hostinger. The Hostinger server only renders pages and runs short API calls (AI scans, admin actions). We don't need long-lived WebSocket connections on Hostinger, and the app stays light on its plan's resources.

```
Phone browser ──HTTPS──> Hostinger (Next.js: pages, server actions, AI calls)
      │                         │
      │                         └──> Claude API (receipt / menu extraction)
      └──Realtime + REST──> Supabase (Auth, Postgres + RLS, Storage)
```

## 2. Key design decisions

- **Money:** integer centavos everywhere (`*_centavos bigint`). Each session stores its own currency (default PHP).
- **Guests:** "quick guest" uses **Supabase anonymous sign-in**, so every participant has a real `auth.uid()` and one set of security rules covers everyone. A guest can later link email or Google and keep their history.
- **Joining:** each session has a short random `join_code`. `/j/<code>` and its QR code call a secured database function `join_session(code, name)`. You can't list or guess other sessions.
- **Price snapshots:** an order item copies its name, unit price and chosen options at order time. Later menu edits don't change past bills.
- **Menu prices are worked out by the database.** Phones call `add_menu_item(item, chosen options, …)`, and the database computes base price plus option price changes, after enforcing each group's required and maximum choices. Phones can't write `menu_item_id`, `options` or `price_is_estimate` directly. Free-text "Other item" lines keep a phone-entered price, since there's no menu to check them against.
- **Same-store guarantee:** categories, items, option groups, options and item↔group links all carry `store_id`, with composite foreign keys, so an option from one store can never be attached to another store's item.
- **Grouping for the waiter:** the app computes a group key from the name, notes and price (plus sorted options from Phase 3), so identical lines group as "3× Iced Latte (Grande, Oat, 50% sugar)". See `src/lib/consolidate.ts`.
- **Ticking a grouped line:** a ✓ applies to the oldest item in the group that isn't fully served yet. An untick applies to the newest served one. The database keeps the served count between 0 and the quantity.
- **Delivery audit:** ticks are an append-only log (`delivery_events`, +1 or −1 each, with who and when). The served count is the sum. Unticking is just a −1, and the full history is kept.
- **Bill split:** pure TypeScript functions in `src/lib/split/`. Shared items split by weight (equal by default). Service charge, tax, discounts and the optional **tip** are spread in proportion to each person's subtotal. Leftover centavos go to people in a fixed, deterministic order (largest remainder, then participant join order), so the totals always add up exactly to the receipt.
- **Multi-tenant ready:** stores belong to an `organization`. Today one platform org owns all stores and admins manage them. Later, a store owner's org manages its own menus, and `subscriptions` attach to orgs.

## 3. Data model (Postgres)

Every table has `id uuid` primary key and `created_at`. FK = foreign key.

### Identity & tenancy
- **profiles** — `user_id` (FK auth.users), `display_name`, `avatar_path`, `payment_qr_path` (GCash/Maya image), `payment_qr_label`, `is_platform_admin bool`, `is_guest bool`
- **organizations** — `name`, `kind` (`platform` | `store_owner`)
- **org_members** — `org_id`, `user_id`, `role` (`owner` | `editor`)
- **plans** — `code`, `name`, `limits jsonb` *(later)*
- **subscriptions** — `org_id`, `plan_id`, `status`, `current_period_end` *(later)*

### Stores & menus
- **stores** — `org_id`, `name`, `branch`, `slug`, `status` (`draft` | `published` | `archived`), `currency`, `vat_inclusive bool`, `default_service_charge_bps` (1000 = 10%), `source_url`, `menu_updated_at`, `created_by_ai bool`
- **menu_categories** — `store_id`, `name`, `sort_order`
- **menu_items** — `store_id`, `category_id`, `name`, `description`, `photo_path`, `base_price_centavos`, `price_status` (`estimated` | `confirmed`), `is_available`, `sort_order`
- **option_groups** — `store_id`, `name` (Size, Milk, Sugar level, Add-ons), `selection` (`single` | `multi`), `min_select`, `max_select`, `sort_order`
- **menu_item_option_groups** — `menu_item_id`, `option_group_id` (lets one "Milk" group be reused across many drinks)
- **options** — `option_group_id`, `name`, `price_delta_centavos`, `is_default`, `sort_order`
- **menu_import_jobs** — `store_id`, `source_type` (`url` | `photo` | `pdf` | `web_search`), `source_ref`, `status`, `ai_output jsonb`, `created_by`
- **menu_reports** — `store_id`, `menu_item_id?`, `reporter_id`, `kind` (`wrong_price` | `missing` | `unavailable` | `other`), `note`, `status` (`open` | `resolved`)

### Sessions & ordering
- **sessions** — `host_id`, `store_id?` (null = free-text only), `title`, `join_code`, `status` (`open` | `closed` | `billing` | `settled`), `order_cutoff_at?`, `currency`, `service_charge_bps`, `closed_at`
- **participants** — `session_id`, `user_id?` (null = added by the host by name, no phone), `display_name`, `is_host`, `joined_at`
- **order_items** — `session_id`, `added_by` (participant), `menu_item_id?` *(Phase 3)*, `name` (snapshot or free text), `unit_price_centavos?` (null = unknown price), `quantity`, `options jsonb` *(Phase 3)*, `notes`, `is_shared`, `price_is_estimate bool` *(Phase 3)*
- **order_item_assignees** — `order_item_id`, `participant_id`, `session_id`, `share_weight int` (default 1). One row = ordered for that person (covers "on behalf of"). Several rows = shared.
- **delivery_events** — `order_item_id`, `session_id`, `delta` (+1 / −1), `by_participant_id`, `created_at`

### Bill & settle-up
- **receipts** — `session_id`, `image_path`, `status` (`scanning` | `review` | `confirmed`), `subtotal_centavos`, `service_charge_centavos`, `tax_centavos`, `discount_centavos`, `tip_centavos`, `total_centavos`, `ai_output jsonb`
- **receipt_lines** — `receipt_id`, `description`, `quantity`, `amount_centavos`, `sort_order`
- **receipt_line_matches** — `receipt_line_id`, `order_item_id`
- **bill_shares** — `session_id`, `participant_id`, `items_centavos`, `service_centavos`, `tax_centavos`, `discount_centavos`, `tip_centavos`, `total_centavos`, `breakdown jsonb` (frozen when the host finalises)
- **payments** — `session_id`, `participant_id`, `marked_paid_at`, `confirmed_by_host_at?`

### Convenience & analytics
- **saved_groups** — `owner_id`, `name`
- **saved_group_members** — `group_id`, `user_id?`, `display_name`
- **favorites** — `user_id`, `store_id`, `menu_item_id`, `options jsonb`, `label` ("My usual")
- Analytics come from queries over `sessions`, `participants` and `stores` (weekly active users, sessions per week, top stores). A separate events table is added only if needed.

## 4. Security (Row-Level Security)

Helper functions: `is_platform_admin()`, `is_session_member(session_id)`, `is_session_host(session_id)`, `can_edit_store(store_id)` (platform admin or editor in the store's org).

| Data | Read | Write |
|---|---|---|
| Published stores and menus | everyone | `can_edit_store` |
| Draft stores and menus | `can_edit_store` | `can_edit_store` |
| sessions, participants, order_items, delivery_events | session members | members add and tick items; only the host changes session settings, closes the session or edits others' items |
| receipts, bill_shares | session members | host |
| payments | session members | the participant (mark paid); host (confirm) |
| profiles | self; a host's payment QR is visible to members of that host's sessions | self |
| menu_reports | admins / store editors | any signed-in user can create |
| saved_groups, favorites | owner | owner |

Storage buckets follow the same rules. Receipts and QR images are private, served through short-lived signed URLs. Menu photos are public.

## 5. Phases (unchanged from the brief)
1. Login + sessions + free-text ordering + consolidated view + delivery checklist
2. Link/QR sharing with guest access
3. Stores, menus, customization options + admin panel (manual entry)
4. AI menu import and "AI add store" with draft approval
5. Receipt scan + bill split + settle up
6. Saved groups, favorites, history, analytics

## 6. Decisions
- Backend: Supabase (approved).
- Tip: an optional line, split proportionally like the service charge.
- Payments: a participant taps "Paid", and the host confirms (`payments.confirmed_by_host_at`).
- Email sign-in uses email + password (Supabase's free email limit makes magic links unreliable). Google sign-in is offered alongside.
