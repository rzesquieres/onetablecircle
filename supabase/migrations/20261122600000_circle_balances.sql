-- OTC-34: running balances across meals in a saved Circle.
--
-- A table can belong to one of your saved groups ("Circle"). Adding a saved
-- group to a table links it; the group's owner can also link or unlink any
-- table they were at. Unpaid shares on linked tables become debts to that
-- table's host; recorded settle-ups cancel debts. The app works out balances
-- and the fewest transfers from circle_ledger().
--
-- Who's who: the group's owner, plus each member, matched to people at a
-- table by account (user_id) or, for name-only members, by name. That way
-- guests without accounts keep their balance inside the Circle.
--
-- Who sees it: the owner, and members who have an account.
--
-- Deploy order: run this migration, then push the app.

alter table public.sessions
  add column saved_group_id uuid references public.saved_groups (id) on delete set null;
create index sessions_saved_group_idx on public.sessions (saved_group_id) where saved_group_id is not null;

-- Settle-ups recorded in the Circle: "Ben paid Ana ₱340".
-- Keys: 'owner' for the group's owner, otherwise a saved_group_members id.
create table public.circle_settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.saved_groups (id) on delete cascade,
  from_key text not null,
  to_key text not null check (to_key <> from_key),
  amount_centavos bigint not null check (amount_centavos > 0 and amount_centavos <= 100000000),
  note text not null default '' check (char_length(note) <= 80),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index circle_settlements_group_idx on public.circle_settlements (group_id);
alter table public.circle_settlements enable row level security;
revoke all on public.circle_settlements from anon, authenticated;

-- Can the caller see this Circle? Its owner, or a member with an account.
create function public.can_view_circle(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_anonymous_user() and (
    exists (select 1 from public.saved_groups where id = p_group_id and owner_id = (select auth.uid()))
    or exists (select 1 from public.saved_group_members where group_id = p_group_id and user_id = (select auth.uid()))
  )
$$;
revoke execute on function public.can_view_circle(uuid) from public, anon;
grant execute on function public.can_view_circle(uuid) to authenticated;

-- The Circle key ('owner' or a member id) for someone at a table, or null.
create function public.circle_key(p_group_id uuid, p_user_id uuid, p_display_name text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_user_id is not null and p_user_id = (select owner_id from public.saved_groups where id = p_group_id) then 'owner'
    else (
      select m.id::text from public.saved_group_members m
      where m.group_id = p_group_id
        and ((m.user_id is not null and m.user_id = p_user_id)
          or (m.user_id is null and lower(trim(m.display_name)) = lower(trim(p_display_name))))
      order by (m.user_id is null), m.sort_order
      limit 1
    )
  end
$$;
revoke execute on function public.circle_key(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Linking tables
-- ---------------------------------------------------------------------
create function public.set_table_circle(p_session_id uuid, p_group_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions;
begin
  if v_uid is null or public.is_anonymous_user() then
    raise exception 'Please sign in with an account first' using errcode = '28000';
  end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found or not exists (select 1 from public.participants where session_id = p_session_id and user_id = v_uid) then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  if p_group_id is not null and not public.owns_group(p_group_id) then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  -- Changing or removing a link: the owner of the linked group, or the host.
  if v_session.saved_group_id is not null and not public.owns_group(v_session.saved_group_id) and v_session.host_id <> v_uid then
    raise exception 'This table is in someone else''s Circle' using errcode = '42501';
  end if;
  update public.sessions set saved_group_id = p_group_id where id = p_session_id;
end $$;
revoke execute on function public.set_table_circle(uuid, uuid) from public, anon;
grant execute on function public.set_table_circle(uuid, uuid) to authenticated;

-- Adding a saved group to a table also links the table to it (if not linked yet).
create or replace function public.add_saved_group_to_session(p_session_id uuid, p_group_id uuid) returns integer
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

  update public.sessions set saved_group_id = p_group_id where id = p_session_id and saved_group_id is null;
  return v_added + v_count;
end $$;

-- ---------------------------------------------------------------------
-- Reading the ledger (raw rows; the app does the math in src/lib/ledger.ts)
-- ---------------------------------------------------------------------
create function public.circle_ledger(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_group public.saved_groups;
  v_me text;
begin
  if not public.can_view_circle(p_group_id) then
    raise exception 'Circle not found' using errcode = 'P0002';
  end if;
  select * into v_group from public.saved_groups where id = p_group_id;
  v_me := public.circle_key(p_group_id, (select auth.uid()), null);

  return jsonb_build_object(
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name),
    'me', v_me,
    'is_owner', v_group.owner_id = (select auth.uid()),
    'members', (
      select jsonb_agg(x order by x.ord)
      from (
        select 'owner' as id, coalesce(nullif(pr.display_name, ''), 'Owner') as name, -1 as ord
        from public.profiles pr where pr.user_id = v_group.owner_id
        union all
        select m.id::text, m.display_name, m.sort_order from public.saved_group_members m where m.group_id = p_group_id
      ) x
    ),
    'tables', coalesce((
      select jsonb_agg(t order by t.date desc)
      from (
        select s.id as session_id, s.title, coalesce(r.finalized_at, s.closed_at, s.created_at) as date,
          (select public.circle_key(p_group_id, p.user_id, p.display_name)
             from public.participants p where p.session_id = s.id and p.is_host limit 1) as host_key,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'key', public.circle_key(p_group_id, p.user_id, p.display_name),
              'total', b.total_centavos,
              'paid', pay.confirmed_at is not null))
            from public.bill_shares b
            join public.participants p on p.id = b.participant_id
            left join public.payments pay on pay.session_id = b.session_id and pay.participant_id = b.participant_id
            where b.session_id = s.id
          ), '[]'::jsonb) as shares
        from public.sessions s
        left join public.receipts r on r.session_id = s.id
        where s.saved_group_id = p_group_id
          and s.status in ('billing', 'settled')
          and exists (select 1 from public.bill_shares b where b.session_id = s.id)
      ) t
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'from', c.from_key, 'to', c.to_key, 'amount', c.amount_centavos,
        'note', c.note, 'created_at', c.created_at,
        'mine', c.created_by = (select auth.uid())) order by c.created_at desc)
      from public.circle_settlements c where c.group_id = p_group_id
    ), '[]'::jsonb)
  );
end $$;
revoke execute on function public.circle_ledger(uuid) from public, anon;
grant execute on function public.circle_ledger(uuid) to authenticated;

-- Circles the caller can see (owned, or a member with an account).
create function public.my_circles() returns table (id uuid, name text, is_owner boolean, tables bigint)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.owner_id = (select auth.uid()),
    (select count(*) from public.sessions s where s.saved_group_id = g.id and s.status in ('billing', 'settled'))
  from public.saved_groups g
  where public.can_view_circle(g.id)
  order by g.name
$$;
revoke execute on function public.my_circles() from public, anon;
grant execute on function public.my_circles() to authenticated;

-- ---------------------------------------------------------------------
-- Settle-ups
-- ---------------------------------------------------------------------
create function public.circle_key_is_valid(p_group_id uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_key = 'owner'
      or exists (select 1 from public.saved_group_members where group_id = p_group_id and id::text = p_key)
$$;
revoke execute on function public.circle_key_is_valid(uuid, text) from public, anon, authenticated;

-- The owner can record any settle-up; a member with an account can record one
-- they paid or received.
create function public.record_circle_settlement(p_group_id uuid, p_from text, p_to text, p_amount bigint, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me text;
  v_id uuid;
begin
  if not public.can_view_circle(p_group_id) then
    raise exception 'Circle not found' using errcode = 'P0002';
  end if;
  if not public.circle_key_is_valid(p_group_id, p_from) or not public.circle_key_is_valid(p_group_id, p_to) or p_from = p_to then
    raise exception 'Choose two different people in this Circle' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Enter an amount' using errcode = '22023';
  end if;
  v_me := public.circle_key(p_group_id, (select auth.uid()), null);
  if not public.owns_group(p_group_id) and v_me is distinct from p_from and v_me is distinct from p_to then
    raise exception 'You can only record payments you made or received' using errcode = '42501';
  end if;
  insert into public.circle_settlements (group_id, from_key, to_key, amount_centavos, note)
  values (p_group_id, p_from, p_to, p_amount, left(coalesce(trim(p_note), ''), 80))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.record_circle_settlement(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.record_circle_settlement(uuid, text, text, bigint, text) to authenticated;

-- Undo: the owner, or whoever recorded it.
create function public.delete_circle_settlement(p_settlement_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.circle_settlements;
begin
  select * into v_row from public.circle_settlements where id = p_settlement_id;
  if not found then
    raise exception 'That payment was already removed' using errcode = 'P0002';
  end if;
  if not public.owns_group(v_row.group_id) and v_row.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the Circle''s owner or whoever recorded it can remove it' using errcode = '42501';
  end if;
  delete from public.circle_settlements where id = p_settlement_id;
end $$;
revoke execute on function public.delete_circle_settlement(uuid) from public, anon;
grant execute on function public.delete_circle_settlement(uuid) to authenticated;
