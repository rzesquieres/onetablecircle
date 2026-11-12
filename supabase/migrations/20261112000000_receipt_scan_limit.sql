-- OneTableCircle — daily receipt-scan limit (OTC-13)
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run this BEFORE deploying the app code that calls claim_receipt_scan().
--
-- Each receipt scan is a paid AI call. Every signed-in person gets
-- app_config.daily_receipt_scan_limit scans per Manila calendar day (default 10).
-- Platform admins are not limited. Rescans count as scans.
--
-- The count lives in receipt_scans. Nobody can write it directly: the only way
-- in is claim_receipt_scan(), which checks the limit and records the scan in one
-- step. Calling it yourself only uses up your own allowance.

alter table public.app_config
  add column daily_receipt_scan_limit integer not null default 10
  check (daily_receipt_scan_limit between 0 and 1000);

grant update (daily_receipt_scan_limit) on public.app_config to authenticated;  -- admins only, via app_config_admin policy

create table public.receipt_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index receipt_scans_user_time on public.receipt_scans (user_id, created_at desc);

alter table public.receipt_scans enable row level security;
revoke all on public.receipt_scans from anon, authenticated;

-- People can see their own scans; admins can see all. No direct writes.
grant select on public.receipt_scans to authenticated;
create policy receipt_scans_read on public.receipt_scans for select to authenticated
  using (user_id = (select auth.uid()) or public.is_platform_admin());

-- Start of today in Manila, as a timestamp.
create function public.manila_day_start() returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('day', now() at time zone 'Asia/Manila')) at time zone 'Asia/Manila'
$$;

-- Records one scan for the signed-in person, or raises OT429 if today's limit is used up.
-- Returns how many scans are left today (null for admins, who aren't limited).
create function public.claim_receipt_scan(p_session_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer;
  v_used integer;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;

  if public.is_platform_admin() then
    insert into public.receipt_scans (user_id, session_id) values (v_uid, p_session_id);
    return null;
  end if;

  -- One claim at a time per person, so two quick taps can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('receipt_scan:' || v_uid::text));

  select coalesce((select daily_receipt_scan_limit from public.app_config), 10) into v_limit;
  select count(*) into v_used from public.receipt_scans
  where user_id = v_uid and created_at >= public.manila_day_start();

  if v_used >= v_limit then
    raise exception using
      errcode = 'OT429',
      message = format('You''ve reached today''s limit of %s receipt scans. You can type the receipt in instead, or try again tomorrow.', v_limit);
  end if;

  insert into public.receipt_scans (user_id, session_id) values (v_uid, p_session_id);
  return v_limit - v_used - 1;
end;
$$;

revoke execute on function public.claim_receipt_scan(uuid) from public;
grant execute on function public.claim_receipt_scan(uuid) to authenticated;
