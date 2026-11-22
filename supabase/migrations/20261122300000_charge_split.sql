-- OTC-35: choose how service charge and tip are shared.
--   'ordered' (default): in proportion to each person's food, after any Senior/PWD discount
--   'even':              the same for everyone who had something
-- Only the host edits receipts (existing receipts_update policy), so a grant is enough.
-- Deploy order: run this migration, then push the app.

alter table public.receipts
  add column service_split text not null default 'ordered' check (service_split in ('ordered', 'even')),
  add column tip_split text not null default 'ordered' check (tip_split in ('ordered', 'even'));
grant update (service_split, tip_split) on public.receipts to authenticated;
