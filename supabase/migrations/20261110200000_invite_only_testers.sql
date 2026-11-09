-- OneTableCircle — invite-only testing
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Then: Authentication -> Auth Hooks -> "Before User Created" -> Postgres function
--       -> public.hook_before_user_created -> Save. (See docs/SETUP-SUPABASE.md.)
--
-- While invite-only is on:
--   * only emails on the testers list (and admins) can create an account
--     (enforced by the auth hook below), and only they can host tables;
--   * quick guests joining a table by link still work;
--   * existing accounts keep signing in; they are added to the list now so
--     nobody already testing is locked out.

create table public.app_config (
  id boolean primary key default true check (id),  -- exactly one row
  invite_only boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.app_config default values;

create table public.beta_testers (
  email text primary key check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  note text not null default '' check (char_length(note) <= 100),
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Everyone who already has a (non-guest) account stays allowed.
insert into public.beta_testers (email, note, added_by)
select lower(trim(email)), 'Existing account', null
from auth.users
where email is not null and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and not coalesce(is_anonymous, false)
on conflict (email) do nothing;

alter table public.app_config enable row level security;
alter table public.beta_testers enable row level security;
revoke all on public.app_config, public.beta_testers from anon, authenticated;

grant select, update (invite_only, updated_at) on public.app_config to authenticated;
create policy app_config_admin on public.app_config for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select, delete, insert (email, note), update (note) on public.beta_testers to authenticated;
create policy beta_testers_admin on public.beta_testers for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- May the signed-in person host tables? (admins, listed testers, or anyone when invite-only is off)
create function public.can_host() returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_anonymous_user() and (
    public.is_platform_admin()
    or not coalesce((select invite_only from public.app_config), false)
    or exists (
      select 1 from public.beta_testers t
      join auth.users u on lower(u.email) = t.email
      where u.id = (select auth.uid())
    )
  )
$$;
grant execute on function public.can_host() to authenticated;

drop policy sessions_insert on public.sessions;
create policy sessions_insert on public.sessions for insert to authenticated
  with check (
    host_id = (select auth.uid())
    and public.can_host()
    and (store_id is null or public.store_is_visible(store_id))
  );

-- Supabase Auth "Before User Created" hook: reject sign-ups from unlisted emails.
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(event -> 'user' ->> 'email'));
begin
  -- Quick guests (anonymous sign-in) can always join a table by link.
  if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false) then
    return '{}'::jsonb;
  end if;
  if not coalesce((select invite_only from public.app_config), false) then
    return '{}'::jsonb;
  end if;
  if v_email is not null and exists (select 1 from public.beta_testers where email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'OneTableCircle is in private testing. Ask the organiser to add your email, or join a table as a guest.'
    )
  );
end $$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant select on public.app_config, public.beta_testers to supabase_auth_admin;
