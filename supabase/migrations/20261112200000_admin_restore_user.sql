-- OneTableCircle — admins can restore (unban) a removed user (OTC-18)
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run this BEFORE deploying the app code that calls admin_restore_user().
-- Safe to run once. Needs 20261112100000_admin_remove_user.sql first.
--
-- Restoring undoes a removal (OTC-16):
--   * the ban is lifted, so they can sign in with their existing account;
--   * the profile's removed flag is cleared and its name comes back;
--   * their names at tables and in saved groups come back (for removals made
--     before this migration the old names weren't kept, so the profile name
--     is used instead);
--   * optionally, they're put back on the testers list;
--   * admin rights are NOT restored; grant them again by SQL if needed;
--   * the removal log row records who restored them, when, and why.
--
-- Removed with "Let this email sign up again": the original email is put
-- back only if no other account uses it now (otherwise the restore is
-- refused: they already have a new account). Their sign-in methods are put
-- back from what the removal saved; for removals made before this migration
-- only an email sign-in is recreated, so they'll need "Forgot password" (or
-- Google again) to get in.

-- What removal now keeps so it can be undone.
alter table public.user_removals
  add column was_tester boolean,                -- null = removed before this was recorded
  add column previous_names jsonb,              -- {"participants": {id: name}, "saved_group_members": {id: name}}
  add column user_meta jsonb,                   -- auth.users.raw_user_meta_data, if it was wiped
  add column identities jsonb,                  -- unlinked auth.identities rows, if any
  add column restored_at timestamptz,
  add column restored_by uuid references auth.users (id) on delete set null,
  add column restore_reason text not null default '' check (char_length(restore_reason) <= 200);

-- Same as OTC-16, but also records old names, tester status and sign-in methods.
create or replace function public.admin_remove_user(
  p_user_id uuid,
  p_reason text default '',
  p_allow_signup boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := (select auth.uid());
  v_email text;
  v_name text;
  v_is_admin boolean;
  v_removed timestamptz;
  v_meta jsonb;
  v_was_tester boolean;
  v_names jsonb;
  v_identities jsonb;
  v_allow boolean := coalesce(p_allow_signup, false);
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

  select u.email, coalesce(p.display_name, ''), coalesce(p.is_platform_admin, false), p.removed_at, u.raw_user_meta_data
    into v_email, v_name, v_is_admin, v_removed, v_meta
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

  v_was_tester := v_email is not null
    and exists (select 1 from public.beta_testers where email = lower(trim(v_email)));
  v_names := jsonb_build_object(
    'participants',
    coalesce((select jsonb_object_agg(id::text, display_name) from public.participants where user_id = p_user_id), '{}'),
    'saved_group_members',
    coalesce((select jsonb_object_agg(id::text, display_name) from public.saved_group_members where user_id = p_user_id), '{}')
  );

  update public.profiles
     set removed_at = now(), display_name = 'Removed user', is_platform_admin = false
   where user_id = p_user_id;
  update public.participants set display_name = 'Removed user' where user_id = p_user_id;
  update public.saved_group_members set display_name = 'Removed user' where user_id = p_user_id;
  if v_email is not null and not v_allow then
    delete from public.beta_testers where email = lower(trim(v_email));
  end if;

  -- Block sign-in and end every login. (A far-future date rather than
  -- 'infinity', which Supabase Auth can't read.)
  update auth.users set banned_until = '2999-12-31 00:00:00+00' where id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;

  if v_allow then
    -- Free the email and unlink sign-in methods, so signing up again (with a
    -- password or the same Google account) creates a new account instead of
    -- landing on this banned one. Keep copies so a restore can undo it.
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'provider', i.provider, 'provider_id', i.provider_id,
             'identity_data', i.identity_data, 'last_sign_in_at', i.last_sign_in_at,
             'created_at', i.created_at, 'updated_at', i.updated_at))
      into v_identities
    from auth.identities i where i.user_id = p_user_id;
    update auth.users
       set email = 'removed-' || p_user_id::text || '@removed.invalid',
           raw_user_meta_data = '{}'::jsonb
     where id = p_user_id;
    delete from auth.identities where user_id = p_user_id;
  end if;

  insert into public.user_removals
    (user_id, email, display_name, reason, allow_signup, removed_by, was_tester, previous_names, user_meta, identities)
  values
    (p_user_id, v_email, v_name, trim(coalesce(p_reason, '')), v_allow, v_admin, v_was_tester, v_names,
     case when v_allow then v_meta end, case when v_allow then coalesce(v_identities, '[]'::jsonb) end);
end $$;

-- A restored user shows their real email again (the removal log only stands
-- in while the account is removed).
create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  is_platform_admin boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  removed_at timestamptz,
  active_tables integer,
  hosting_tables integer,
  unpaid_bills integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
  select
    u.id,
    (case when p.removed_at is not null then
       coalesce((select r.email from public.user_removals r where r.user_id = u.id order by r.removed_at desc limit 1), u.email)
     else u.email end)::text,
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

-- Restore a removed account. Admins only; checked here, on the server.
-- p_add_to_testers: null = put them back only if they were a tester before.
-- Returns what the app needs for the "your account is back" email.
create function public.admin_restore_user(
  p_user_id uuid,
  p_reason text default '',
  p_add_to_testers boolean default null
) returns table (email text, display_name text, needs_password_reset boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_admin uuid := (select auth.uid());
  v_removed timestamptz;
  r public.user_removals%rowtype;
  v_email text;
  v_name text;
  v_reset boolean := false;
  v_ident jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if char_length(coalesce(p_reason, '')) > 200 then
    raise exception 'Keep the reason under 200 characters' using errcode = '22023';
  end if;

  select p.removed_at, u.email into v_removed, v_email
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = p_user_id
  for update of u;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_removed is null then
    raise exception 'That user isn''t removed' using errcode = 'P0001';
  end if;

  select * into r from public.user_removals ur
  where ur.user_id = p_user_id and ur.restored_at is null
  order by ur.removed_at desc limit 1
  for update;
  if not found then
    raise exception 'No removal record for that user' using errcode = 'P0002';
  end if;

  if r.allow_signup then
    if r.email is null then
      raise exception 'The removal log has no email for this account, so it can''t be restored'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from auth.users o where lower(o.email) = lower(r.email) and o.id <> p_user_id) then
      raise exception 'Can''t restore: % has already signed up again, so they now have a new account', r.email
        using errcode = 'P0001';
    end if;
    update auth.users
       set email = r.email,
           raw_user_meta_data = coalesce(r.user_meta, raw_user_meta_data)
     where id = p_user_id;
    v_email := r.email;

    if r.identities is null then
      -- Removed before sign-in methods were saved: recreate an email sign-in
      -- so "Forgot password" works.
      v_reset := true;
      insert into auth.identities (user_id, provider, provider_id, identity_data, created_at, updated_at)
      values (p_user_id, 'email', p_user_id::text,
              jsonb_build_object('sub', p_user_id::text, 'email', r.email, 'email_verified', true),
              now(), now())
      on conflict do nothing;
    else
      for v_ident in select * from jsonb_array_elements(r.identities) loop
        -- Skip one that now belongs to a new account (e.g. the same Google login).
        continue when exists (
          select 1 from auth.identities i
          where i.provider = v_ident->>'provider' and i.provider_id = v_ident->>'provider_id'
        );
        insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
        values ((v_ident->>'id')::uuid, p_user_id, v_ident->>'provider', v_ident->>'provider_id',
                coalesce(v_ident->'identity_data', '{}'::jsonb), (v_ident->>'last_sign_in_at')::timestamptz,
                coalesce((v_ident->>'created_at')::timestamptz, now()), now());
      end loop;
      -- Nothing to sign in with (e.g. a skipped Google login): they'll need a new password.
      if not exists (select 1 from auth.identities where user_id = p_user_id) then
        v_reset := true;
        insert into auth.identities (user_id, provider, provider_id, identity_data, created_at, updated_at)
        values (p_user_id, 'email', p_user_id::text,
                jsonb_build_object('sub', p_user_id::text, 'email', r.email, 'email_verified', true), now(), now());
      end if;
    end if;
  end if;

  -- Lift the ban.
  update auth.users set banned_until = null where id = p_user_id;

  v_name := left(coalesce(nullif(trim(r.display_name), ''), ''), 60);
  update public.profiles set removed_at = null, display_name = v_name where user_id = p_user_id;

  -- Names at tables and in saved groups: the saved ones, else the profile name.
  update public.participants pa
     set display_name = left(coalesce(r.previous_names->'participants'->>pa.id::text, nullif(v_name, ''), 'Guest'), 40)
   where pa.user_id = p_user_id and pa.display_name = 'Removed user';
  update public.saved_group_members m
     set display_name = left(coalesce(r.previous_names->'saved_group_members'->>m.id::text, nullif(v_name, ''), 'Guest'), 40)
   where m.user_id = p_user_id and m.display_name = 'Removed user';

  if v_email is not null and coalesce(p_add_to_testers, r.was_tester, false) then
    insert into public.beta_testers (email, note, added_by)
    values (lower(trim(v_email)), 'Restored account', v_admin)
    on conflict (email) do nothing;
  end if;

  update public.user_removals
     set restored_at = now(), restored_by = v_admin, restore_reason = trim(coalesce(p_reason, ''))
   where id = r.id;

  return query select v_email, v_name, v_reset;
end $$;

revoke execute on function public.admin_restore_user(uuid, text, boolean) from public, anon;
grant execute on function public.admin_restore_user(uuid, text, boolean) to authenticated;
