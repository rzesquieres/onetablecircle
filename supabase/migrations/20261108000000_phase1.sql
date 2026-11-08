-- OneTableCircle — Phase 1 schema
-- Login, table sessions, free-text ordering, consolidated view, delivery checklist.
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste this whole
-- file -> Run. Run it once on a fresh project.
--
-- Money is stored as integer centavos (bigint). Never floats.

-- =====================================================================
-- Profiles (one per signed-in user, created automatically on sign-up)
-- =====================================================================
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Guest'
    ), 60)
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =====================================================================
-- Sessions ("tables")
-- =====================================================================
create type public.session_status as enum ('open', 'closed', 'billing', 'settled');

-- 8-character code from an unambiguous alphabet (no 0/O/1/I), using
-- cryptographically random bytes from gen_random_uuid().
create function public.generate_join_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1),
    '' order by ord)
  from (select uuid_send(gen_random_uuid()) as b) s,
       unnest(array[0, 1, 2, 3, 4, 5, 9, 10]) with ordinality as t(i, ord)
$$;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 80),
  join_code text not null unique default public.generate_join_code(),
  status public.session_status not null default 'open',
  order_cutoff_at timestamptz,
  currency char(3) not null default 'PHP',
  service_charge_bps integer not null default 1000 check (service_charge_bps between 0 and 10000),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_host_id_idx on public.sessions (host_id);

-- =====================================================================
-- Participants (people at the table; user_id is null for people the
-- host added by name, e.g. someone without a phone)
-- =====================================================================
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create index participants_user_id_idx on public.participants (user_id);

-- =====================================================================
-- Order items, who they are for, and delivery (served) events
-- =====================================================================
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  added_by uuid not null references public.participants (id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  unit_price_centavos bigint check (unit_price_centavos >= 0),  -- null = price unknown
  quantity integer not null default 1 check (quantity between 1 and 99),
  notes text not null default '' check (char_length(notes) <= 200),
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);
create index order_items_session_id_idx on public.order_items (session_id);

-- One row = the item is for that person. Several rows = shared item.
create table public.order_item_assignees (
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  share_weight integer not null default 1 check (share_weight between 1 and 100),
  primary key (order_item_id, participant_id)
);
create index order_item_assignees_session_id_idx on public.order_item_assignees (session_id);

-- Append-only log: +1 = one unit served, -1 = unticked. Served = sum(delta).
create table public.delivery_events (
  id bigint generated always as identity primary key,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  delta smallint not null check (delta in (-1, 1)),
  by_participant_id uuid references public.participants (id) on delete set null,
  created_at timestamptz not null default now()
);
create index delivery_events_session_id_idx on public.delivery_events (session_id);
create index delivery_events_order_item_id_idx on public.delivery_events (order_item_id);

-- =====================================================================
-- Helper functions used by the security policies
-- =====================================================================
create function public.is_session_member(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participants
    where session_id = p_session_id and user_id = (select auth.uid())
  )
$$;

create function public.is_session_host(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions
    where id = p_session_id and host_id = (select auth.uid())
  )
$$;

create function public.my_participant_id(p_session_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.participants
  where session_id = p_session_id and user_id = (select auth.uid())
$$;

-- Open, and the order cutoff (if any) has not passed.
create function public.session_accepts_orders(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions
    where id = p_session_id
      and status = 'open'
      and (order_cutoff_at is null or order_cutoff_at > now())
  )
$$;

-- Serving can still be ticked after ordering closes, until billing starts.
create function public.session_is_active(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions
    where id = p_session_id and status in ('open', 'closed')
  )
$$;

-- Item authors can edit their items while ordering is open;
-- the host can edit any item until billing starts.
create function public.can_edit_items(p_session_id uuid, p_added_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    (p_added_by = public.my_participant_id(p_session_id) and public.session_accepts_orders(p_session_id))
    or (public.is_session_host(p_session_id) and public.session_is_active(p_session_id))
$$;

-- =====================================================================
-- Triggers that keep data consistent
-- =====================================================================

-- The host automatically becomes the first participant.
create function public.add_host_participant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.participants (session_id, user_id, display_name, is_host)
  values (
    new.id,
    new.host_id,
    coalesce((select nullif(trim(display_name), '') from public.profiles where user_id = new.host_id), 'Host'),
    true
  );
  return new;
end $$;

create trigger sessions_add_host
after insert on public.sessions
for each row execute function public.add_host_participant();

-- Assignees: copy session_id from the item and make sure the person is at the same table.
create function public.prepare_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select session_id into new.session_id from public.order_items where id = new.order_item_id;
  if new.session_id is null then
    raise exception 'Order item not found';
  end if;
  if not exists (
    select 1 from public.participants where id = new.participant_id and session_id = new.session_id
  ) then
    raise exception 'That person is not at this table';
  end if;
  return new;
end $$;

create trigger order_item_assignees_prepare
before insert on public.order_item_assignees
for each row execute function public.prepare_assignee();

-- Delivery events: copy session_id and keep 0 <= served <= quantity (row lock avoids races).
create function public.prepare_delivery_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_qty integer;
  v_served integer;
begin
  select session_id, quantity into new.session_id, v_qty
  from public.order_items where id = new.order_item_id
  for update;
  if not found then
    raise exception 'Order item not found';
  end if;
  select coalesce(sum(delta), 0) into v_served
  from public.delivery_events where order_item_id = new.order_item_id;
  if v_served + new.delta < 0 or v_served + new.delta > v_qty then
    raise exception 'Served count must stay between 0 and %', v_qty using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger delivery_events_prepare
before insert on public.delivery_events
for each row execute function public.prepare_delivery_event();

-- Quantity can't drop below what has already been served.
create function public.check_item_quantity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_served integer;
begin
  if new.quantity < old.quantity then
    select coalesce(sum(delta), 0) into v_served
    from public.delivery_events where order_item_id = new.id;
    if new.quantity < v_served then
      raise exception '% already served; untick first', v_served using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger order_items_check_quantity
before update of quantity on public.order_items
for each row execute function public.check_item_quantity();

-- =====================================================================
-- Row-Level Security: people only see tables they are part of
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_assignees enable row level security;
alter table public.delivery_events enable row level security;

-- Start from nothing, then grant exactly what the app needs.
revoke all on public.profiles, public.sessions, public.participants,
  public.order_items, public.order_item_assignees, public.delivery_events
  from anon, authenticated;

-- profiles
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- sessions
grant select, delete on public.sessions to authenticated;
grant insert (host_id, title, order_cutoff_at, currency, service_charge_bps) on public.sessions to authenticated;
grant update (title, status, order_cutoff_at, service_charge_bps, closed_at) on public.sessions to authenticated;
create policy sessions_select on public.sessions for select to authenticated
  using (host_id = (select auth.uid()) or public.is_session_member(id));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (host_id = (select auth.uid()));
create policy sessions_update on public.sessions for update to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy sessions_delete on public.sessions for delete to authenticated
  using (host_id = (select auth.uid()));

-- participants
grant select, delete on public.participants to authenticated;
grant insert (session_id, display_name) on public.participants to authenticated;
grant update (display_name) on public.participants to authenticated;
create policy participants_select on public.participants for select to authenticated
  using (public.is_session_member(session_id) or public.is_session_host(session_id));
-- Host can add a person by name (no account). People with accounts join via join_session().
create policy participants_insert on public.participants for insert to authenticated
  with check (public.is_session_host(session_id) and user_id is null and not is_host);
create policy participants_update on public.participants for update to authenticated
  using (user_id = (select auth.uid()) or public.is_session_host(session_id))
  with check (user_id = (select auth.uid()) or public.is_session_host(session_id));
create policy participants_delete on public.participants for delete to authenticated
  using (public.is_session_host(session_id) and not is_host);

-- order_items
grant select, delete on public.order_items to authenticated;
grant insert (session_id, added_by, name, unit_price_centavos, quantity, notes, is_shared)
  on public.order_items to authenticated;
grant update (name, unit_price_centavos, quantity, notes, is_shared) on public.order_items to authenticated;
create policy order_items_select on public.order_items for select to authenticated
  using (public.is_session_member(session_id));
create policy order_items_insert on public.order_items for insert to authenticated
  with check (
    added_by = public.my_participant_id(session_id)
    and public.session_accepts_orders(session_id)
  );
create policy order_items_update on public.order_items for update to authenticated
  using (public.can_edit_items(session_id, added_by))
  with check (public.can_edit_items(session_id, added_by));
create policy order_items_delete on public.order_items for delete to authenticated
  using (public.can_edit_items(session_id, added_by));

-- order_item_assignees
grant select, delete on public.order_item_assignees to authenticated;
grant insert (order_item_id, participant_id, share_weight) on public.order_item_assignees to authenticated;
create policy assignees_select on public.order_item_assignees for select to authenticated
  using (public.is_session_member(session_id));
create policy assignees_insert on public.order_item_assignees for insert to authenticated
  with check (exists (
    select 1 from public.order_items o
    where o.id = order_item_id and public.can_edit_items(o.session_id, o.added_by)
  ));
create policy assignees_delete on public.order_item_assignees for delete to authenticated
  using (exists (
    select 1 from public.order_items o
    where o.id = order_item_id and public.can_edit_items(o.session_id, o.added_by)
  ));

-- delivery_events (append-only: no update or delete)
grant select on public.delivery_events to authenticated;
grant insert (order_item_id, delta, by_participant_id) on public.delivery_events to authenticated;
create policy delivery_select on public.delivery_events for select to authenticated
  using (public.is_session_member(session_id));
create policy delivery_insert on public.delivery_events for insert to authenticated
  with check (
    by_participant_id = public.my_participant_id(session_id)
    and public.session_is_active(session_id)
  );

-- =====================================================================
-- Functions the app calls
-- =====================================================================

-- Join a table by its code. Returns the session id. Safe to call twice.
create function public.join_session(p_code text, p_display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;
  select * into v_session from public.sessions where join_code = upper(trim(p_code));
  if not found then
    raise exception 'Table not found. Check the code.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.participants where session_id = v_session.id and user_id = v_uid) then
    return v_session.id;
  end if;
  if v_session.status not in ('open', 'closed') then
    raise exception 'This table has finished' using errcode = 'P0001';
  end if;
  insert into public.participants (session_id, user_id, display_name)
  values (
    v_session.id,
    v_uid,
    left(coalesce(
      nullif(trim(p_display_name), ''),
      (select nullif(trim(display_name), '') from public.profiles where user_id = v_uid),
      'Guest'
    ), 40)
  );
  return v_session.id;
end $$;

-- Add an item and who it is for, in one step. Runs with the caller's
-- permissions, so all the rules above still apply.
create function public.add_order_item(
  p_session_id uuid,
  p_name text,
  p_unit_price_centavos bigint,
  p_quantity integer,
  p_notes text,
  p_is_shared boolean,
  p_assignee_ids uuid[]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_pid uuid := public.my_participant_id(p_session_id);
  v_ids uuid[] := array(select distinct x from unnest(p_assignee_ids) as x where x is not null);
  v_item uuid;
begin
  if v_pid is null then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Choose who this item is for' using errcode = '22023';
  end if;
  if not p_is_shared and array_length(v_ids, 1) <> 1 then
    raise exception 'A non-shared item is for exactly one person' using errcode = '22023';
  end if;

  insert into public.order_items (session_id, added_by, name, unit_price_centavos, quantity, notes, is_shared)
  values (p_session_id, v_pid, trim(p_name), p_unit_price_centavos, p_quantity, coalesce(trim(p_notes), ''), p_is_shared)
  returning id into v_item;

  insert into public.order_item_assignees (order_item_id, participant_id)
  select v_item, x from unnest(v_ids) as x;

  return v_item;
end $$;

revoke execute on function public.join_session(text, text) from public, anon;
revoke execute on function public.add_order_item(uuid, text, bigint, integer, text, boolean, uuid[]) from public, anon;
grant execute on function public.join_session(text, text) to authenticated;
grant execute on function public.add_order_item(uuid, text, bigint, integer, text, boolean, uuid[]) to authenticated;

-- =====================================================================
-- Realtime: push changes to everyone at the table
-- =====================================================================
alter table public.sessions replica identity full;
alter table public.participants replica identity full;
alter table public.order_items replica identity full;
alter table public.order_item_assignees replica identity full;
alter table public.delivery_events replica identity full;

alter publication supabase_realtime add table
  public.sessions,
  public.participants,
  public.order_items,
  public.order_item_assignees,
  public.delivery_events;
