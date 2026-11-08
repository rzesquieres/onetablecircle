-- OneTableCircle — Phase 4: AI menu import, "AI add store", menu reports
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run it once, after the Phase 1–3 files.
--
-- AI output never goes live directly. An import job holds the AI's draft;
-- an admin reviews and edits it, then apply_menu_import() writes it in one
-- step with every price marked "estimated". New stores stay drafts until
-- an admin publishes them.

-- =====================================================================
-- Import jobs
-- =====================================================================
create type public.import_kind as enum ('add_store', 'import_url', 'import_file');
create type public.import_status as enum ('running', 'ready', 'failed', 'applied');

create table public.menu_import_jobs (
  id uuid primary key default gen_random_uuid(),
  -- null for "AI add store" until the draft is applied
  store_id uuid references public.stores (id) on delete cascade,
  kind public.import_kind not null,
  input jsonb not null default '{}'::jsonb,
  status public.import_status not null default 'running',
  result jsonb,
  error text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_import_jobs_created_idx on public.menu_import_jobs (created_at desc);

create function public.can_manage_import(p_store_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or (p_store_id is not null and public.can_edit_store(p_store_id))
$$;
grant execute on function public.can_manage_import(uuid) to authenticated;

alter table public.menu_import_jobs enable row level security;
revoke all on public.menu_import_jobs from anon, authenticated;
grant select, delete on public.menu_import_jobs to authenticated;
grant insert (store_id, kind, input) on public.menu_import_jobs to authenticated;
grant update (store_id, status, result, error, updated_at) on public.menu_import_jobs to authenticated;
create policy import_jobs_all on public.menu_import_jobs for all to authenticated
  using (public.can_manage_import(store_id)) with check (public.can_manage_import(store_id));

-- =====================================================================
-- Apply a reviewed draft. p_menu (prices already in centavos):
-- {
--   "store": {"name", "branch", "source_url"},          -- used for add_store
--   "option_groups": [{"name", "selection", "min_select", "max_select",
--                      "options": [{"name", "price_delta_centavos"}]}],
--   "categories": [{"name", "items": [{"name", "description",
--                   "base_price_centavos", "option_groups": ["Size", ...]}]}]
-- }
-- Categories and option groups with the same name as existing ones are
-- reused; items are always added. Runs with the caller's permissions.
-- =====================================================================
create function public.apply_menu_import(p_job_id uuid, p_menu jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.menu_import_jobs;
  v_store uuid;
  v_source text := nullif(trim(p_menu -> 'store' ->> 'source_url'), '');
  v_groups jsonb := '{}'::jsonb;
  v_group jsonb;
  v_gid uuid;
  v_cat jsonb;
  v_cid uuid;
  v_item jsonb;
  v_iid uuid;
  v_gname text;
  v_sort integer;
begin
  select * into v_job from public.menu_import_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'ready' then
    raise exception 'This import is % and cannot be applied', v_job.status using errcode = '22023';
  end if;

  if v_source is not null and v_source !~* '^https?://' then
    v_source := null;
  end if;

  v_store := v_job.store_id;
  if v_store is null then
    insert into public.stores (name, branch, status, source_url)
    values (
      left(trim(coalesce(nullif(p_menu -> 'store' ->> 'name', ''), v_job.input ->> 'name', 'New store')), 80),
      left(trim(coalesce(p_menu -> 'store' ->> 'branch', v_job.input ->> 'branch', '')), 80),
      'draft',
      v_source
    )
    returning id into v_store;
  elsif v_source is not null then
    update public.stores set source_url = v_source where id = v_store and source_url is null;
  end if;

  -- Option groups (reuse by name)
  for v_group in select * from jsonb_array_elements(coalesce(p_menu -> 'option_groups', '[]'::jsonb)) loop
    select id into v_gid from public.option_groups
    where store_id = v_store and lower(name) = lower(trim(v_group ->> 'name'))
    limit 1;
    if v_gid is null then
      select count(*) into v_sort from public.option_groups where store_id = v_store;
      insert into public.option_groups (store_id, name, selection, min_select, max_select, sort_order)
      values (
        v_store,
        left(trim(v_group ->> 'name'), 60),
        coalesce((v_group ->> 'selection')::public.option_selection, 'single'),
        coalesce((v_group ->> 'min_select')::integer, 0),
        (v_group ->> 'max_select')::integer,
        v_sort
      )
      returning id into v_gid;
      insert into public.options (store_id, option_group_id, name, price_delta_centavos, sort_order)
      select v_store, v_gid, left(trim(o.value ->> 'name'), 60),
        coalesce((o.value ->> 'price_delta_centavos')::bigint, 0), (o.ordinality - 1)::integer
      from jsonb_array_elements(coalesce(v_group -> 'options', '[]'::jsonb)) with ordinality as o(value, ordinality)
      where nullif(trim(o.value ->> 'name'), '') is not null;
    end if;
    v_groups := v_groups || jsonb_build_object(lower(trim(v_group ->> 'name')), v_gid);
    v_gid := null;
  end loop;

  -- Categories (reuse by name) and items (always added, prices estimated)
  for v_cat in select * from jsonb_array_elements(coalesce(p_menu -> 'categories', '[]'::jsonb)) loop
    select id into v_cid from public.menu_categories
    where store_id = v_store and lower(name) = lower(trim(v_cat ->> 'name'))
    limit 1;
    if v_cid is null then
      select count(*) into v_sort from public.menu_categories where store_id = v_store;
      insert into public.menu_categories (store_id, name, sort_order)
      values (v_store, left(trim(v_cat ->> 'name'), 60), v_sort)
      returning id into v_cid;
    end if;

    select count(*) into v_sort from public.menu_items where category_id = v_cid;
    for v_item in select * from jsonb_array_elements(coalesce(v_cat -> 'items', '[]'::jsonb)) loop
      insert into public.menu_items (store_id, category_id, name, description, base_price_centavos, price_status, sort_order)
      values (
        v_store, v_cid,
        left(trim(v_item ->> 'name'), 120),
        left(coalesce(trim(v_item ->> 'description'), ''), 500),
        (v_item ->> 'base_price_centavos')::bigint,
        'estimated',
        v_sort
      )
      returning id into v_iid;
      v_sort := v_sort + 1;

      for v_gname in select lower(trim(value)) from jsonb_array_elements_text(coalesce(v_item -> 'option_groups', '[]'::jsonb)) loop
        if v_groups ? v_gname then
          insert into public.menu_item_option_groups (menu_item_id, option_group_id, store_id)
          values (v_iid, (v_groups ->> v_gname)::uuid, v_store)
          on conflict do nothing;
        end if;
      end loop;
    end loop;
    v_cid := null;
  end loop;

  update public.menu_import_jobs
  set status = 'applied', store_id = v_store, updated_at = now()
  where id = p_job_id;

  return v_store;
end $$;

revoke execute on function public.apply_menu_import(uuid, jsonb) from public, anon;
grant execute on function public.apply_menu_import(uuid, jsonb) to authenticated;

-- =====================================================================
-- Menu reports: anyone at a table can flag a wrong item or price
-- =====================================================================
create type public.report_kind as enum ('wrong_price', 'wrong_item', 'unavailable', 'other');

create table public.menu_reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
  kind public.report_kind not null,
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index menu_reports_open_idx on public.menu_reports (status, created_at desc);

alter table public.menu_reports enable row level security;
revoke all on public.menu_reports from anon, authenticated;
grant select on public.menu_reports to authenticated;
grant insert (store_id, menu_item_id, kind, note) on public.menu_reports to authenticated;
grant update (status, resolved_at, resolved_by) on public.menu_reports to authenticated;

create policy menu_reports_insert on public.menu_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and public.store_is_visible(store_id)
    and (
      menu_item_id is null
      or exists (select 1 from public.menu_items i where i.id = menu_item_id and i.store_id = menu_reports.store_id)
    )
  );
create policy menu_reports_select on public.menu_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.can_edit_store(store_id));
create policy menu_reports_update on public.menu_reports for update to authenticated
  using (public.can_edit_store(store_id)) with check (public.can_edit_store(store_id));
