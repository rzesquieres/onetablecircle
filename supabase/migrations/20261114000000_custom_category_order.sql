-- OneTableCircle — diner-friendly menu order (OTC-24)
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run this AFTER 20261113100000_post_meal_rating.sql, and BEFORE deploying the
-- app code that adds the "Category order" setting to the store editor.
--
-- By default the menu now shows categories in the order diners look for them
-- (popular, starters, mains, sharing, sides, drinks, desserts). A store admin
-- can switch a store to "custom" so the menu follows their own order instead.

alter table public.stores add column custom_category_order boolean not null default false;

grant insert (custom_category_order) on public.stores to authenticated;
grant update (custom_category_order) on public.stores to authenticated;
