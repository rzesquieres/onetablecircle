-- OneTableCircle — OTC-28: menu import into a new OR existing store, with merge
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run it once, after the earlier files. Safe to run before the app update:
-- the old apply_menu_import() is left untouched.
--
-- apply_menu_import_v2(job, menu, target_store, mode):
--   * target_store: for an "AI add store" job, null = create a new (draft)
--     store, or the id of an existing store to update instead. For imports
--     started from a store's editor, the job's own store is always used.
--   * mode (existing store only):
--       'merge'   - items with the same name are updated in place, new items
--                   are added, items missing from the upload are left alone.
--       'replace' - same as merge, but items missing from the upload are
--                   hidden (marked unavailable), never deleted, so past
--                   orders and favourites stay intact.
--   Same name = case-insensitive, surrounding/repeated spaces ignored. An
--   existing item in the same category is preferred over one elsewhere.
--   An updated price is marked "estimated" unless it didn't change. An empty
--   description in the upload keeps the current one.
-- Returns {"store_id", "created_store", "added", "updated", "hidden"} and
-- saves the same summary on the job (result.applied_summary).

create function public.menu_name_key(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
grant execute on function public.menu_name_key(text) to authenticated;

create function public.apply_menu_import_v2(
  p_job_id uuid,
  p_menu jsonb,
  p_target_store_id uuid default null,
  p_mode text default 'merge'
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.menu_import_jobs;
  v_store uuid;
  v_created boolean := false;
  v_source text := nullif(trim(p_menu -> 'store' ->> 'source_url'), '');
  v_groups jsonb := '{}'::jsonb;
  v_group jsonb;
  v_opt jsonb;
  v_gid uuid;
  v_oid uuid;
  v_cat jsonb;
  v_cid uuid;
  v_item jsonb;
  v_iid uuid;
  v_old public.menu_items;
  v_gname text;
  v_sort integer;
  v_touched uuid[] := '{}';
  v_added integer := 0;
  v_updated integer := 0;
  v_hidden integer := 0;
  v_price bigint;
  v_desc text;
  v_summary jsonb;
begin
  if p_mode not in ('merge', 'replace') then
    raise exception 'Unknown import mode %', p_mode using errcode = '22023';
  end if;

  select * into v_job from public.menu_import_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'ready' then
    raise exception 'This import is % and cannot be applied', v_job.status using errcode = '22023';
  end if;
  if v_job.store_id is not null and p_target_store_id is not null and p_target_store_id <> v_job.store_id then
    raise exception 'This import belongs to another store' using errcode = '22023';
  end if;

  if v_source is not null and v_source !~* '^https?://' then
    v_source := null;
  end if;

  v_store := coalesce(v_job.store_id, p_target_store_id);
  if v_store is null then
    insert into public.stores (name, branch, status, source_url)
    values (
      left(trim(coalesce(nullif(p_menu -> 'store' ->> 'name', ''), v_job.input ->> 'name', 'New store')), 80),
      left(trim(coalesce(p_menu -> 'store' ->> 'branch', v_job.input ->> 'branch', '')), 80),
      'draft',
      v_source
    )
    returning id into v_store;
    v_created := true;
  else
    if not public.can_edit_store(v_store) or not exists (select 1 from public.stores where id = v_store) then
      raise exception 'Store not found' using errcode = 'P0002';
    end if;
    if v_source is not null then
      update public.stores set source_url = v_source where id = v_store and source_url is null;
    end if;
  end if;

  -- Option groups: reuse by name; update choice prices, add new choices.
  for v_group in select * from jsonb_array_elements(coalesce(p_menu -> 'option_groups', '[]'::jsonb)) loop
    continue when public.menu_name_key(v_group ->> 'name') = '';
    select id into v_gid from public.option_groups
    where store_id = v_store and public.menu_name_key(name) = public.menu_name_key(v_group ->> 'name')
    order by sort_order, created_at
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
    end if;
    for v_opt in select * from jsonb_array_elements(coalesce(v_group -> 'options', '[]'::jsonb)) loop
      continue when public.menu_name_key(v_opt ->> 'name') = '';
      select id into v_oid from public.options
      where option_group_id = v_gid and public.menu_name_key(name) = public.menu_name_key(v_opt ->> 'name')
      limit 1;
      if v_oid is null then
        select count(*) into v_sort from public.options where option_group_id = v_gid;
        insert into public.options (store_id, option_group_id, name, price_delta_centavos, sort_order)
        values (v_store, v_gid, left(trim(v_opt ->> 'name'), 60), coalesce((v_opt ->> 'price_delta_centavos')::bigint, 0), v_sort);
      else
        update public.options
        set price_delta_centavos = coalesce((v_opt ->> 'price_delta_centavos')::bigint, 0)
        where id = v_oid and price_delta_centavos is distinct from coalesce((v_opt ->> 'price_delta_centavos')::bigint, 0);
      end if;
      v_oid := null;
    end loop;
    v_groups := v_groups || jsonb_build_object(public.menu_name_key(v_group ->> 'name'), v_gid);
    v_gid := null;
  end loop;

  -- Categories (reuse by name) and items (update by name, else add).
  for v_cat in select * from jsonb_array_elements(coalesce(p_menu -> 'categories', '[]'::jsonb)) loop
    select id into v_cid from public.menu_categories
    where store_id = v_store and public.menu_name_key(name) = public.menu_name_key(v_cat ->> 'name')
    order by sort_order, created_at
    limit 1;
    if v_cid is null then
      select count(*) into v_sort from public.menu_categories where store_id = v_store;
      insert into public.menu_categories (store_id, name, sort_order)
      values (v_store, left(trim(v_cat ->> 'name'), 60), v_sort)
      returning id into v_cid;
    end if;

    select count(*) into v_sort from public.menu_items where category_id = v_cid;
    for v_item in select * from jsonb_array_elements(coalesce(v_cat -> 'items', '[]'::jsonb)) loop
      v_price := (v_item ->> 'base_price_centavos')::bigint;
      v_desc := left(coalesce(trim(v_item ->> 'description'), ''), 500);

      -- Each existing item is matched at most once per import.
      select * into v_old from public.menu_items
      where store_id = v_store
        and public.menu_name_key(name) = public.menu_name_key(v_item ->> 'name')
        and not (id = any (v_touched))
      order by (category_id = v_cid) desc, created_at
      limit 1;

      if v_old.id is not null then
        v_iid := v_old.id;
        update public.menu_items set
          name = left(regexp_replace(trim(v_item ->> 'name'), '\s+', ' ', 'g'), 120),
          description = case when v_desc = '' then description else v_desc end,
          base_price_centavos = v_price,
          price_status = case when base_price_centavos = v_price then price_status else 'estimated'::public.price_status end,
          category_id = v_cid,
          sort_order = case when category_id = v_cid then sort_order else v_sort end,
          is_available = case when p_mode = 'replace' then true else is_available end
        where id = v_iid;
        if v_old.category_id <> v_cid then
          v_sort := v_sort + 1;
        end if;
        v_updated := v_updated + 1;
      else
        insert into public.menu_items (store_id, category_id, name, description, base_price_centavos, price_status, sort_order)
        values (v_store, v_cid, left(regexp_replace(trim(v_item ->> 'name'), '\s+', ' ', 'g'), 120), v_desc, v_price, 'estimated', v_sort)
        returning id into v_iid;
        v_sort := v_sort + 1;
        v_added := v_added + 1;
      end if;
      v_touched := v_touched || v_iid;
      v_old := null;

      for v_gname in select public.menu_name_key(value) from jsonb_array_elements_text(coalesce(v_item -> 'option_groups', '[]'::jsonb)) loop
        if v_groups ? v_gname then
          insert into public.menu_item_option_groups (menu_item_id, option_group_id, store_id)
          values (v_iid, (v_groups ->> v_gname)::uuid, v_store)
          on conflict do nothing;
        end if;
      end loop;
    end loop;
    v_cid := null;
  end loop;

  -- Replace: hide (never delete) items that weren't in the upload.
  if p_mode = 'replace' and not v_created then
    update public.menu_items set is_available = false
    where store_id = v_store and is_available and not (id = any (v_touched));
    get diagnostics v_hidden = row_count;
  end if;

  v_summary := jsonb_build_object(
    'store_id', v_store,
    'created_store', v_created,
    'mode', case when v_created then 'new' else p_mode end,
    'added', v_added,
    'updated', v_updated,
    'hidden', v_hidden
  );

  update public.menu_import_jobs
  set status = 'applied',
      store_id = v_store,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object('applied_summary', v_summary),
      updated_at = now()
  where id = p_job_id;

  return v_summary;
end $$;

revoke execute on function public.apply_menu_import_v2(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.apply_menu_import_v2(uuid, jsonb, uuid, text) to authenticated;
