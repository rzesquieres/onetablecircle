-- OneTableCircle — Phase 3: stores, menus, customization options, admin
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run it once, after the Phase 1 and Phase 2 files.
--
-- Multi-tenant ready: every store belongs to an organization. For now one
-- "platform" organization owns all stores and platform admins edit them;
-- later, store owners get their own organization (org_members) and edit
-- only their stores.

-- =====================================================================
-- Organizations (tenants) and admins
-- =====================================================================
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  kind text not null default 'store_owner' check (kind in ('platform', 'store_owner')),
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

insert into public.organizations (id, name, kind)
values ('00000000-0000-0000-0000-000000000001', 'OneTableCircle', 'platform');

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select is_platform_admin from public.profiles where user_id = (select auth.uid())),
    false
  )
$$;

-- =====================================================================
-- Stores and menus
-- =====================================================================
create type public.store_status as enum ('draft', 'published', 'archived');
create type public.price_status as enum ('estimated', 'confirmed');
create type public.option_selection as enum ('single', 'multi');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations (id),
  name text not null check (char_length(trim(name)) between 1 and 80),
  branch text not null default '' check (char_length(branch) <= 80),
  status public.store_status not null default 'draft',
  currency char(3) not null default 'PHP',
  vat_inclusive boolean not null default true,
  default_service_charge_bps integer not null default 1000 check (default_service_charge_bps between 0 and 10000),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  menu_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index stores_name_idx on public.stores (lower(name));

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, store_id)
);
create index menu_categories_store_id_idx on public.menu_categories (store_id);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  base_price_centavos bigint not null check (base_price_centavos >= 0),
  price_status public.price_status not null default 'confirmed',
  photo_path text,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  -- The category must belong to the same store.
  foreign key (category_id, store_id) references public.menu_categories (id, store_id) on delete cascade
);
create index menu_items_store_id_idx on public.menu_items (store_id);

-- e.g. "Size" (single, required), "Add-ons" (multi, up to 3)
create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  selection public.option_selection not null default 'single',
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer check (max_select is null or max_select >= 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  check (max_select is null or max_select >= min_select)
);
create index option_groups_store_id_idx on public.option_groups (store_id);

-- e.g. "Grande" +₱20, "Oat milk" +₱30
create table public.options (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  option_group_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  price_delta_centavos bigint not null default 0,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  foreign key (option_group_id, store_id) references public.option_groups (id, store_id) on delete cascade
);
create index options_group_idx on public.options (option_group_id);

-- Which option groups apply to which item (one "Milk" group reused by many drinks).
create table public.menu_item_option_groups (
  menu_item_id uuid not null,
  option_group_id uuid not null,
  store_id uuid not null,
  sort_order integer not null default 0,
  primary key (menu_item_id, option_group_id),
  foreign key (menu_item_id, store_id) references public.menu_items (id, store_id) on delete cascade,
  foreign key (option_group_id, store_id) references public.option_groups (id, store_id) on delete cascade
);
create index menu_item_option_groups_store_idx on public.menu_item_option_groups (store_id);

-- Keep stores.menu_updated_at current ("menu last updated" for users).
create function public.touch_store_menu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.stores set menu_updated_at = now()
  where id = coalesce(new.store_id, old.store_id);
  return null;
end $$;

create trigger menu_categories_touch after insert or update or delete on public.menu_categories
  for each row execute function public.touch_store_menu();
create trigger menu_items_touch after insert or update or delete on public.menu_items
  for each row execute function public.touch_store_menu();
create trigger option_groups_touch after insert or update or delete on public.option_groups
  for each row execute function public.touch_store_menu();
create trigger options_touch after insert or update or delete on public.options
  for each row execute function public.touch_store_menu();
create trigger menu_item_option_groups_touch after insert or update or delete on public.menu_item_option_groups
  for each row execute function public.touch_store_menu();

-- =====================================================================
-- Who can see / edit a store
-- =====================================================================
create function public.can_edit_store(p_store_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.stores s
    join public.org_members m on m.org_id = s.org_id
    where s.id = p_store_id and m.user_id = (select auth.uid())
  )
$$;

-- Published stores are visible to everyone signed in; drafts only to editors.
create function public.store_is_visible(p_store_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stores where id = p_store_id and status = 'published')
    or public.can_edit_store(p_store_id)
$$;

-- Can the caller edit stores of this organization? Used on the stores table
-- itself (checks the row's org_id directly, so it also works while a new
-- store row is being inserted).
create function public.can_edit_org(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.org_members m where m.org_id = p_org_id and m.user_id = (select auth.uid())
  )
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.can_edit_org(uuid) to authenticated;
grant execute on function public.can_edit_store(uuid) to authenticated;
grant execute on function public.store_is_visible(uuid) to authenticated;

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.stores enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.option_groups enable row level security;
alter table public.options enable row level security;
alter table public.menu_item_option_groups enable row level security;

revoke all on public.organizations, public.org_members, public.stores, public.menu_categories,
  public.menu_items, public.option_groups, public.options, public.menu_item_option_groups
  from anon, authenticated;

-- organizations / org_members: platform admins manage; members see their own.
grant select, insert, update, delete on public.organizations, public.org_members to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_platform_admin() or exists (
    select 1 from public.org_members m where m.org_id = organizations.id and m.user_id = (select auth.uid())
  ));
create policy organizations_write on public.organizations for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy org_members_select on public.org_members for select to authenticated
  using (public.is_platform_admin() or user_id = (select auth.uid()));
create policy org_members_write on public.org_members for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- stores
grant select, delete on public.stores to authenticated;
grant insert (org_id, name, branch, status, currency, vat_inclusive, default_service_charge_bps, source_url)
  on public.stores to authenticated;
grant update (name, branch, status, currency, vat_inclusive, default_service_charge_bps, source_url)
  on public.stores to authenticated;
create policy stores_select on public.stores for select to authenticated
  using (status = 'published' or public.can_edit_org(org_id));
create policy stores_insert on public.stores for insert to authenticated
  with check (public.can_edit_org(org_id));
create policy stores_update on public.stores for update to authenticated
  using (public.can_edit_org(org_id)) with check (public.can_edit_org(org_id));
create policy stores_delete on public.stores for delete to authenticated
  using (public.can_edit_org(org_id));

-- menu tables: read if the store is visible, write if you can edit the store.
grant select, delete on public.menu_categories, public.menu_items, public.option_groups,
  public.options, public.menu_item_option_groups to authenticated;
grant insert (store_id, name, sort_order), update (name, sort_order) on public.menu_categories to authenticated;
grant insert (store_id, category_id, name, description, base_price_centavos, price_status, photo_path, is_available, sort_order),
  update (category_id, name, description, base_price_centavos, price_status, photo_path, is_available, sort_order)
  on public.menu_items to authenticated;
grant insert (store_id, name, selection, min_select, max_select, sort_order),
  update (name, selection, min_select, max_select, sort_order) on public.option_groups to authenticated;
grant insert (store_id, option_group_id, name, price_delta_centavos, is_default, sort_order),
  update (name, price_delta_centavos, is_default, sort_order) on public.options to authenticated;
grant insert (menu_item_id, option_group_id, store_id, sort_order), update (sort_order)
  on public.menu_item_option_groups to authenticated;

create policy menu_categories_select on public.menu_categories for select to authenticated
  using (public.store_is_visible(store_id));
create policy menu_categories_write on public.menu_categories for all to authenticated
  using (public.can_edit_store(store_id)) with check (public.can_edit_store(store_id));

create policy menu_items_select on public.menu_items for select to authenticated
  using (public.store_is_visible(store_id));
create policy menu_items_write on public.menu_items for all to authenticated
  using (public.can_edit_store(store_id)) with check (public.can_edit_store(store_id));

create policy option_groups_select on public.option_groups for select to authenticated
  using (public.store_is_visible(store_id));
create policy option_groups_write on public.option_groups for all to authenticated
  using (public.can_edit_store(store_id)) with check (public.can_edit_store(store_id));

create policy options_select on public.options for select to authenticated
  using (public.store_is_visible(store_id));
create policy options_write on public.options for all to authenticated
  using (public.can_edit_store(store_id)) with check (public.can_edit_store(store_id));

create policy menu_item_option_groups_select on public.menu_item_option_groups for select to authenticated
  using (public.store_is_visible(store_id));
create policy menu_item_option_groups_write on public.menu_item_option_groups for all to authenticated
  using (public.can_edit_store(store_id)) with check (public.can_edit_store(store_id));

-- =====================================================================
-- Tables at a store, and menu orders
-- =====================================================================
alter table public.sessions
  add column store_id uuid references public.stores (id) on delete set null;
create index sessions_store_id_idx on public.sessions (store_id);
grant insert (store_id) on public.sessions to authenticated;

-- Hosts need a real account, and can only pick a store they can see.
drop policy sessions_insert on public.sessions;
create policy sessions_insert on public.sessions for insert to authenticated
  with check (
    host_id = (select auth.uid())
    and not public.is_anonymous_user()
    and (store_id is null or public.store_is_visible(store_id))
  );

-- Snapshot of what was ordered, so later menu edits never change past bills.
-- Not insertable by users directly: only add_menu_item() fills these.
alter table public.order_items
  add column menu_item_id uuid references public.menu_items (id) on delete set null,
  add column options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  add column price_is_estimate boolean not null default false;

-- Order a menu item. The price is worked out here from the menu, never
-- trusted from the phone. Checks the same things the security rules do.
create function public.add_menu_item(
  p_session_id uuid,
  p_menu_item_id uuid,
  p_option_ids uuid[],
  p_quantity integer,
  p_notes text,
  p_is_shared boolean,
  p_assignee_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_pid uuid := public.my_participant_id(p_session_id);
  v_store uuid;
  v_item public.menu_items;
  v_opt_ids uuid[] := array(select distinct x from unnest(coalesce(p_option_ids, '{}')) as x where x is not null);
  v_people uuid[] := array(select distinct x from unnest(coalesce(p_assignee_ids, '{}')) as x where x is not null);
  v_group record;
  v_delta bigint;
  v_snapshot jsonb;
  v_order uuid;
begin
  if v_pid is null then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  if not public.session_accepts_orders(p_session_id) then
    raise exception 'Ordering is closed for this table' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) not between 1 and 99 then
    raise exception 'Quantity must be between 1 and 99' using errcode = '22023';
  end if;
  if coalesce(array_length(v_people, 1), 0) = 0 then
    raise exception 'Choose who this item is for' using errcode = '22023';
  end if;
  if not p_is_shared and array_length(v_people, 1) <> 1 then
    raise exception 'A non-shared item is for exactly one person' using errcode = '22023';
  end if;

  select store_id into v_store from public.sessions where id = p_session_id;
  select * into v_item from public.menu_items where id = p_menu_item_id;
  if not found or v_store is null or v_item.store_id <> v_store or not public.store_is_visible(v_store) then
    raise exception 'That item is not on this table''s menu' using errcode = '22023';
  end if;
  if not v_item.is_available then
    raise exception '% is not available right now', v_item.name using errcode = '22023';
  end if;

  -- Every chosen option must belong to a group attached to this item.
  if exists (
    select 1 from unnest(v_opt_ids) as x
    where not exists (
      select 1 from public.options o
      join public.menu_item_option_groups l on l.option_group_id = o.option_group_id
      where o.id = x and l.menu_item_id = p_menu_item_id
    )
  ) then
    raise exception 'One of the chosen options does not apply to %', v_item.name using errcode = '22023';
  end if;

  -- Respect each group's required / maximum choices.
  for v_group in
    select g.name, g.selection, g.min_select, g.max_select,
      (select count(*) from public.options o where o.option_group_id = g.id and o.id = any (v_opt_ids)) as chosen
    from public.option_groups g
    join public.menu_item_option_groups l on l.option_group_id = g.id
    where l.menu_item_id = p_menu_item_id
  loop
    if v_group.chosen < v_group.min_select then
      raise exception 'Please choose % for %', lower(v_group.name), v_item.name using errcode = '22023';
    end if;
    if (v_group.selection = 'single' and v_group.chosen > 1)
       or (v_group.max_select is not null and v_group.chosen > v_group.max_select) then
      raise exception 'Too many choices for %', lower(v_group.name) using errcode = '22023';
    end if;
  end loop;

  select
    coalesce(sum(o.price_delta_centavos), 0),
    coalesce(jsonb_agg(
      jsonb_build_object('group', g.name, 'option', o.name, 'price_delta_centavos', o.price_delta_centavos)
      order by l.sort_order, g.sort_order, o.sort_order, o.name
    ), '[]'::jsonb)
  into v_delta, v_snapshot
  from public.options o
  join public.option_groups g on g.id = o.option_group_id
  join public.menu_item_option_groups l on l.option_group_id = g.id and l.menu_item_id = p_menu_item_id
  where o.id = any (v_opt_ids);

  if v_item.base_price_centavos + v_delta < 0 then
    raise exception 'Price cannot be negative' using errcode = '22023';
  end if;

  insert into public.order_items (
    session_id, added_by, menu_item_id, name, unit_price_centavos, quantity, notes,
    is_shared, options, price_is_estimate
  ) values (
    p_session_id, v_pid, v_item.id, v_item.name, v_item.base_price_centavos + v_delta, p_quantity,
    left(coalesce(trim(p_notes), ''), 200), p_is_shared, v_snapshot, v_item.price_status = 'estimated'
  )
  returning id into v_order;

  -- prepare_assignee() checks every person is at this table.
  insert into public.order_item_assignees (order_item_id, participant_id)
  select v_order, x from unnest(v_people) as x;

  return v_order;
end $$;

revoke execute on function public.add_menu_item(uuid, uuid, uuid[], integer, text, boolean, uuid[]) from public, anon;
grant execute on function public.add_menu_item(uuid, uuid, uuid[], integer, text, boolean, uuid[]) to authenticated;

-- =====================================================================
-- Menu photos (Supabase Storage). Public to view; editors upload into
-- a folder named after the store id: menu-photos/<store_id>/<file>.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-photos', 'menu-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function public.can_edit_store_folder(p_object_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.can_edit_store(split_part(p_object_name, '/', 1)::uuid);
exception when invalid_text_representation then
  return false;
end $$;
grant execute on function public.can_edit_store_folder(text) to authenticated;

create policy menu_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos' and public.can_edit_store_folder(name));
create policy menu_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'menu-photos' and public.can_edit_store_folder(name))
  with check (bucket_id = 'menu-photos' and public.can_edit_store_folder(name));
create policy menu_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu-photos' and public.can_edit_store_folder(name));

-- =====================================================================
-- Make the owner a platform admin (no effect if these emails have no account yet).
-- =====================================================================
update public.profiles set is_platform_admin = true
where user_id in (
  select id from auth.users where lower(email) in ('rzesquieres@gmail.com', 'admin@onetablecircle.com')
);
