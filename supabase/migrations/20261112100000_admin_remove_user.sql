-- OneTableCircle — admins can remove a user account (OTC-16)
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run this BEFORE deploying the app code that calls admin_list_users() /
-- admin_remove_user(). Safe to run once.
--
-- Removal is a soft delete. The account row stays, so every table, bill and
-- payment the person was part of stays intact and the totals don't change.
-- What happens:
--   * the profile is marked removed and renamed "Removed user"; their name at
--     every table (and in other people's saved groups) becomes "Removed user";
--   * they lose admin rights and their testers-list entry;
--   * their Supabase Auth account is banned and all its sessions are deleted,
--     so they can't sign in again or refresh a login (an access token already
--     issued stays valid until it expires, at most about an hour; the app
--     signs them out as soon as it sees the removed profile, and they can't
--     host new tables);
--   * a row is written to user_removals (who, by whom, when, optional reason).
-- Because the account still exists, the same email can't sign up again.

alter table public.profiles add column removed_at timestamptz;

create table public.user_removals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  reason text not null default '' check (char_length(reason) <= 200),
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz not null default now()
);
create index user_removals_removed_at_idx on public.user_removals (removed_at desc);

alter table public.user_removals enable row level security;
revoke all on public.user_removals from anon, authenticated;
grant select on public.user_removals to authenticated;
create policy user_removals_admin_select on public.user_removals for select to authenticated
  using (public.is_platform_admin());

-- Removed people can't host new tables (even with a still-valid login).
create or replace function public.can_host() returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_anonymous_user()
    and not exists (
      select 1 from public.profiles where user_id = (select auth.uid()) and removed_at is not null
    )
    and (
      public.is_platform_admin()
      or not coalesce((select invite_only from public.app_config), false)
      or exists (
        select 1 from public.beta_testers t
        join auth.users u on lower(u.email) = t.email
        where u.id = (select auth.uid())
      )
    )
$$;

-- Accounts for the admin Users page (quick guests are left out), with what
-- removing each one would affect.
create function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  is_platform_admin boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  removed_at timestamptz,
  active_tables integer,   -- tables they're at that aren't settled yet
  hosting_tables integer,  -- of those, tables they host
  unpaid_bills integer     -- bills sent to them that aren't confirmed paid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
  select
    u.id,
    u.email::text,
    coalesce(p.display_name, ''),
    coalesce(p.is_platform_admin, false),
    u.created_at,
    u.last_sign_in_at,
    p.removed_at,
    (select count(*)::integer from public.participants pa
       join public.sessions s on s.id = pa.session_id
      where pa.user_id = u.id and s.status <> 'settled'),
    (select count(*)::integer from public.sessions s
      where s.host_id = u.id and s.status <> 'settled'),
    (select count(*)::integer from public.bill_shares b
       join public.participants pa on pa.id = b.participant_id
       join public.sessions s on s.id = b.session_id
       left join public.payments pay on pay.session_id = b.session_id and pay.participant_id = b.participant_id
      where pa.user_id = u.id and s.status <> 'settled' and b.total_centavos > 0
        and pay.confirmed_at is null)
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where not coalesce(u.is_anonymous, false)
  order by p.removed_at nulls first, u.created_at desc;
end $$;

-- Remove (soft delete) an account. Admins only; checked here, on the server.
create function public.admin_remove_user(p_user_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := (select auth.uid());
  v_email text;
  v_name text;
  v_is_admin boolean;
  v_removed timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_user_id = v_admin then
    raise exception 'You can''t remove your own account here' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_reason, '')) > 200 then
    raise exception 'Keep the reason under 200 characters' using errcode = '22023';
  end if;

  select u.email, coalesce(p.display_name, ''), coalesce(p.is_platform_admin, false), p.removed_at
    into v_email, v_name, v_is_admin, v_removed
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = p_user_id
  for update of u;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_removed is not null then
    raise exception 'That user has already been removed' using errcode = 'P0001';
  end if;
  if v_is_admin and not exists (
    select 1 from public.profiles
    where is_platform_admin and removed_at is null and user_id <> p_user_id
  ) then
    raise exception 'You can''t remove the last admin' using errcode = 'P0001';
  end if;

  update public.profiles
     set removed_at = now(), display_name = 'Removed user', is_platform_admin = false
   where user_id = p_user_id;
  update public.participants set display_name = 'Removed user' where user_id = p_user_id;
  update public.saved_group_members set display_name = 'Removed user' where user_id = p_user_id;
  if v_email is not null then
    delete from public.beta_testers where email = lower(trim(v_email));
  end if;

  -- Block sign-in and end every login. (A far-future date rather than
  -- 'infinity', which Supabase Auth can't read.)
  update auth.users set banned_until = '2999-12-31 00:00:00+00' where id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;

  insert into public.user_removals (user_id, email, display_name, reason, removed_by)
  values (p_user_id, v_email, v_name, trim(coalesce(p_reason, '')), v_admin);
end $$;

revoke execute on function public.admin_list_users() from public, anon;
revoke execute on function public.admin_remove_user(uuid, text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_remove_user(uuid, text) to authenticated;
