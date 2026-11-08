-- OneTableCircle — Phase 2: link/QR sharing with quick guest access
--
-- Guests use Supabase anonymous sign-in: they get a real (anonymous) user id,
-- so every Phase 1 security rule applies to them unchanged. This migration:
--   * stops guests from hosting tables (hosts must have a real account),
--   * lets anyone with a join code see a small preview of the table,
--   * remembers the name a guest typed when joining.
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run it once, after the Phase 1 file.

-- True when the caller signed in anonymously (quick guest).
create function public.is_anonymous_user() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
$$;
grant execute on function public.is_anonymous_user() to authenticated;

-- Hosts must have a real account (email or Google), not a guest session.
drop policy sessions_insert on public.sessions;
create policy sessions_insert on public.sessions for insert to authenticated
  with check (host_id = (select auth.uid()) and not public.is_anonymous_user());

-- What the join screen shows before someone joins: only the table title,
-- the host's display name, its status and how many people are in it.
create function public.table_preview(p_code text)
returns table (title text, host_name text, status public.session_status, people integer)
language sql stable security definer set search_path = '' as $$
  select
    s.title,
    (select p.display_name from public.participants p where p.session_id = s.id and p.is_host),
    s.status,
    (select count(*)::integer from public.participants p where p.session_id = s.id)
  from public.sessions s
  where s.join_code = upper(trim(p_code))
$$;
revoke execute on function public.table_preview(text) from public;
grant execute on function public.table_preview(text) to anon, authenticated;

-- Same as Phase 1, plus: a guest's typed name is saved on their profile so
-- it is reused next time.
create or replace function public.join_session(p_code text, p_display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions;
  v_name text;
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

  v_name := left(coalesce(
    nullif(trim(p_display_name), ''),
    (select nullif(trim(display_name), '') from public.profiles where user_id = v_uid),
    'Guest'
  ), 40);

  insert into public.participants (session_id, user_id, display_name)
  values (v_session.id, v_uid, v_name);

  if public.is_anonymous_user() then
    update public.profiles set display_name = v_name where user_id = v_uid;
  end if;

  return v_session.id;
end $$;
