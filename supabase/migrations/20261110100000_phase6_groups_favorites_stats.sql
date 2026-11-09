-- OneTableCircle — Phase 6: saved groups, favorites ("my usual"), admin analytics
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run it once, after the Phase 1–5 files.

-- Have these two accounts ever been at the same table?
create function public.shared_a_table(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participants x
    join public.participants y on y.session_id = x.session_id
    where x.user_id = p_a and y.user_id = p_b
  )
$$;
grant execute on function public.shared_a_table(uuid, uuid) to authenticated;

-- =====================================================================
-- Saved groups ("Family", "Office") for quick table setup
-- =====================================================================
create table public.saved_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create index saved_groups_owner_idx on public.saved_groups (owner_id);

-- A member is either someone you've shared a table with (user_id) or just a name.
create table public.saved_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.saved_groups (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  sort_order integer not null default 0,
  unique (group_id, user_id)
);
create index saved_group_members_group_idx on public.saved_group_members (group_id);

create function public.owns_group(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saved_groups where id = p_group_id and owner_id = (select auth.uid()))
$$;
grant execute on function public.owns_group(uuid) to authenticated;

alter table public.saved_groups enable row level security;
alter table public.saved_group_members enable row level security;
revoke all on public.saved_groups, public.saved_group_members from anon, authenticated;

grant select, delete on public.saved_groups to authenticated;
grant insert (name), update (name) on public.saved_groups to authenticated;
create policy saved_groups_own on public.saved_groups for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and not public.is_anonymous_user());

grant select, delete on public.saved_group_members to authenticated;
grant insert (group_id, user_id, display_name, sort_order), update (display_name, sort_order)
  on public.saved_group_members to authenticated;
create policy saved_group_members_own on public.saved_group_members for all to authenticated
  using (public.owns_group(group_id))
  with check (
    public.owns_group(group_id)
    -- You can only save real accounts of people you've actually sat with.
    and (user_id is null or public.shared_a_table((select auth.uid()), user_id))
  );

-- Add a saved group to a table you host. People with accounts are added
-- straight in (the table shows up on their phone); name-only members are
-- added like "someone without a phone". Returns how many were added.
create function public.add_saved_group_to_session(p_session_id uuid, p_group_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_added integer := 0;
  v_count integer;
begin
  if not public.is_session_host(p_session_id) or public.is_anonymous_user() then
    raise exception 'Only the host can add people' using errcode = '42501';
  end if;
  if not public.owns_group(p_group_id) then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  if not public.session_is_active(p_session_id) then
    raise exception 'This table has finished' using errcode = '22023';
  end if;

  insert into public.participants (session_id, user_id, display_name)
  select p_session_id, m.user_id, m.display_name
  from public.saved_group_members m
  where m.group_id = p_group_id
    and m.user_id is not null
    and m.user_id <> v_uid
    and public.shared_a_table(v_uid, m.user_id)
  on conflict (session_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  v_added := v_added + v_count;

  insert into public.participants (session_id, user_id, display_name)
  select p_session_id, null, m.display_name
  from public.saved_group_members m
  where m.group_id = p_group_id
    and m.user_id is null
    and not exists (
      select 1 from public.participants p
      where p.session_id = p_session_id and lower(trim(p.display_name)) = lower(trim(m.display_name))
    );
  get diagnostics v_count = row_count;
  return v_added + v_count;
end $$;
revoke execute on function public.add_saved_group_to_session(uuid, uuid) from public, anon;
grant execute on function public.add_saved_group_to_session(uuid, uuid) to authenticated;

-- =====================================================================
-- Favorites: "my usual" per store (an item plus chosen options and notes)
-- =====================================================================
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  option_ids uuid[] not null default '{}',
  notes text not null default '' check (char_length(notes) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, menu_item_id, option_ids)
);
create index favorites_user_store_idx on public.favorites (user_id, store_id);

alter table public.favorites enable row level security;
revoke all on public.favorites from anon, authenticated;
grant select, delete on public.favorites to authenticated;
grant insert (store_id, menu_item_id, option_ids, notes) on public.favorites to authenticated;
create policy favorites_own on public.favorites for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.store_is_visible(store_id)
    and exists (select 1 from public.menu_items i where i.id = menu_item_id and i.store_id = favorites.store_id)
  );

-- =====================================================================
-- Admin analytics (counts only, no personal data)
-- =====================================================================
create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'users_registered', (select count(*) from auth.users where not coalesce(is_anonymous, false)),
    'users_guest', (select count(*) from auth.users where coalesce(is_anonymous, false)),
    'active_7d', (
      select count(distinct p.user_id) from public.participants p
      join public.sessions s on s.id = p.session_id
      where p.user_id is not null and s.created_at >= now() - interval '7 days'),
    'active_30d', (
      select count(distinct p.user_id) from public.participants p
      join public.sessions s on s.id = p.session_id
      where p.user_id is not null and s.created_at >= now() - interval '30 days'),
    'tables_7d', (select count(*) from public.sessions where created_at >= now() - interval '7 days'),
    'tables_30d', (select count(*) from public.sessions where created_at >= now() - interval '30 days'),
    'bills_sent_30d', (select count(*) from public.receipts where finalized_at >= now() - interval '30 days'),
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object('week', w.week::date, 'tables', w.tables, 'people', w.people) order by w.week), '[]'::jsonb)
      from (
        select g.week,
          (select count(*) from public.sessions s where s.created_at >= g.week and s.created_at < g.week + interval '7 days') as tables,
          (select count(*) from public.participants p join public.sessions s on s.id = p.session_id
            where s.created_at >= g.week and s.created_at < g.week + interval '7 days') as people
        from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as g(week)
      ) w),
    'top_stores', (
      select coalesce(jsonb_agg(t order by t.tables desc, t.name), '[]'::jsonb)
      from (
        select st.id as store_id, st.name, st.branch, count(*) as tables
        from public.sessions s join public.stores st on st.id = s.store_id
        where s.created_at >= now() - interval '90 days'
        group by st.id, st.name, st.branch
        order by count(*) desc, st.name
        limit 10
      ) t),
    'free_text_tables_90d', (
      select count(*) from public.sessions where store_id is null and created_at >= now() - interval '90 days'),
    'stores_published', (select count(*) from public.stores where status = 'published'),
    'ai_imports_30d', (select count(*) from public.menu_import_jobs where created_at >= now() - interval '30 days'),
    'open_reports', (select count(*) from public.menu_reports where status = 'open')
  ) into v_result;
  return v_result;
end $$;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
