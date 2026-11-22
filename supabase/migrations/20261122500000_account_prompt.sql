-- OTC-36: after the bill is sent, invite guests (anonymous sign-in) to create
-- an account. Upgrading keeps the same user id (Supabase links the email or
-- Google identity to the guest), so their tables and payments stay theirs.
--
-- account_prompt_events: counts only (shown / dismissed per table, converted
-- once per user), for the admin analytics. Written by the database only.
--
-- Deploy order: run this migration, then push the app.

create table public.account_prompt_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  event text not null check (event in ('shown', 'dismissed', 'converted')),
  created_at timestamptz not null default now()
);
create unique index account_prompt_events_once_idx
  on public.account_prompt_events (user_id, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid), event);
alter table public.account_prompt_events enable row level security;
revoke all on public.account_prompt_events from anon, authenticated;

-- True if the caller is a guest at this table, the bill has been sent, and
-- they haven't said "Not now" for this table. Records that it was shown.
create function public.account_prompt_due(p_session_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return false;
  end if;
  if not exists (select 1 from auth.users where id = v_uid and is_anonymous) then
    return false;
  end if;
  if not exists (select 1 from public.participants where session_id = p_session_id and user_id = v_uid) then
    return false;
  end if;
  if not exists (select 1 from public.sessions where id = p_session_id and status in ('billing', 'settled')) then
    return false;
  end if;
  if exists (
    select 1 from public.account_prompt_events
    where user_id = v_uid and session_id = p_session_id and event = 'dismissed'
  ) then
    return false;
  end if;
  insert into public.account_prompt_events (user_id, session_id, event) values (v_uid, p_session_id, 'shown')
  on conflict do nothing;
  return true;
end $$;
revoke execute on function public.account_prompt_due(uuid) from public, anon;
grant execute on function public.account_prompt_due(uuid) to authenticated;

create function public.dismiss_account_prompt(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from public.participants where session_id = p_session_id and user_id = v_uid) then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  insert into public.account_prompt_events (user_id, session_id, event) values (v_uid, p_session_id, 'dismissed')
  on conflict do nothing;
end $$;
revoke execute on function public.dismiss_account_prompt(uuid) from public, anon;
grant execute on function public.dismiss_account_prompt(uuid) to authenticated;

-- A guest became a full account: count it, if they had seen the prompt.
create function public.account_prompt_note_conversion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.is_anonymous and not new.is_anonymous
     and exists (select 1 from public.account_prompt_events where user_id = new.id and event = 'shown') then
    insert into public.account_prompt_events (user_id, session_id, event) values (new.id, null, 'converted')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger account_prompt_conversion
after update of is_anonymous on auth.users
for each row execute function public.account_prompt_note_conversion();

-- Admin analytics: how many guests saw the prompt, and how many created an account.
create function public.admin_account_prompt_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'shown_users', (select count(distinct user_id) from public.account_prompt_events where event = 'shown'),
    'converted_users', (select count(distinct user_id) from public.account_prompt_events where event = 'converted'),
    'shown_30d', (select count(distinct user_id) from public.account_prompt_events
                  where event = 'shown' and created_at > now() - interval '30 days'),
    'converted_30d', (select count(distinct user_id) from public.account_prompt_events
                      where event = 'converted' and created_at > now() - interval '30 days')
  );
end $$;
revoke execute on function public.admin_account_prompt_stats() from public, anon;
grant execute on function public.admin_account_prompt_stats() to authenticated;
