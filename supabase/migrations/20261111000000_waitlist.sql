-- OneTableCircle — Circle Plus waitlist (pricing page)
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run this BEFORE deploying the app code that adds /pricing.
--
-- Anyone (signed in or not) can add an email through join_waitlist().
-- Nobody but platform admins can read the list, and the function never says
-- whether an email was already on it.

create table public.waitlist (
  email text primary key check (
    char_length(email) <= 254 and email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  plan text not null default 'undecided' check (plan in ('monthly', 'yearly', 'undecided')),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

grant select, delete on public.waitlist to authenticated;
create policy waitlist_admin on public.waitlist for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create function public.join_waitlist(p_email text, p_plan text default 'undecided') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Please enter a valid email address.';
  end if;
  if coalesce(p_plan, 'undecided') not in ('monthly', 'yearly', 'undecided') then
    raise exception 'Unknown plan.';
  end if;
  insert into public.waitlist (email, plan, user_id)
  values (v_email, coalesce(p_plan, 'undecided'), auth.uid())
  on conflict (email) do update set plan = excluded.plan;
end;
$$;

revoke execute on function public.join_waitlist(text, text) from public;
grant execute on function public.join_waitlist(text, text) to anon, authenticated;
