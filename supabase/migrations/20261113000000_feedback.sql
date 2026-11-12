-- OneTableCircle — in-app feedback (OTC-22)
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run this BEFORE deploying the app code that adds /feedback.
--
-- Anyone using the app can send feedback: account holders, guests who joined
-- through a link, and visitors (the app signs a visitor in as a guest when they
-- press Send). The only way in is submit_feedback(), which checks the input,
-- applies a daily limit and records who sent it and from where.
-- Only platform admins can read feedback or change its status.
--
-- The kind column also allows 'post_meal' for the post-meal rating (OTC-23),
-- which adds its own function in a later migration.

alter table public.app_config
  add column daily_feedback_limit integer not null default 5
  check (daily_feedback_limit between 0 and 100);

grant update (daily_feedback_limit) on public.app_config to authenticated;  -- admins only, via app_config_admin policy

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  -- Snapshots, so the inbox still makes sense after a table or account is gone.
  sender_name text not null default '' check (char_length(sender_name) <= 60),
  sender_is_guest boolean not null default false,
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  kind text not null default 'form' check (kind in ('form', 'post_meal')),
  category text check (category in ('bug', 'idea', 'other')),
  rating smallint check (rating between 1 and 5),
  message text not null default '' check (char_length(message) <= 2000),
  page_path text not null default '' check (char_length(page_path) <= 200),
  session_id uuid references public.sessions (id) on delete set null,
  table_title text not null default '' check (char_length(table_title) <= 120),
  user_agent text not null default '' check (char_length(user_agent) <= 300),
  status text not null default 'new' check (status in ('new', 'read', 'done')),
  check (kind <> 'form' or (category is not null and char_length(trim(message)) > 0)),
  check (kind <> 'post_meal' or rating is not null)
);
create index feedback_created on public.feedback (created_at desc);
create index feedback_user_time on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- Admins read everything and can change the status. Nobody else can see or write rows directly.
grant select, delete on public.feedback to authenticated;
grant update (status) on public.feedback to authenticated;
create policy feedback_admin on public.feedback for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Records one piece of feedback from the signed-in person (account or guest).
-- p_session_id is only kept if the sender is at that table. Raises OT429 when
-- today's limit is used up; admins aren't limited.
create function public.submit_feedback(
  p_category text,
  p_message text,
  p_page_path text default '',
  p_session_id uuid default null,
  p_contact_email text default null,
  p_contact_ok boolean default false,
  p_user_agent text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_guest boolean := public.is_anonymous_user();
  v_message text := trim(coalesce(p_message, ''));
  v_email text := nullif(lower(trim(coalesce(p_contact_email, ''))), '');
  v_limit integer;
  v_used integer;
  v_name text;
  v_session uuid;
  v_title text := '';
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  if coalesce(p_category, '') not in ('bug', 'idea', 'other') then
    raise exception 'Please choose what kind of feedback this is.';
  end if;
  if v_message = '' then
    raise exception 'Please type your feedback.';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'Please keep feedback under 2,000 characters.';
  end if;

  if not public.is_platform_admin() then
    -- One at a time per person, so quick repeated taps can't slip past the limit.
    perform pg_advisory_xact_lock(hashtext('feedback:' || v_uid::text));
    select coalesce((select daily_feedback_limit from public.app_config), 5) into v_limit;
    select count(*) into v_used from public.feedback
    where user_id = v_uid and kind = 'form' and created_at >= public.manila_day_start();
    if v_used >= v_limit then
      raise exception using
        errcode = 'OT429',
        message = 'Thanks! You''ve sent a lot of feedback today. Please try again tomorrow, or email admin@onetablecircle.com.';
    end if;
  end if;

  -- Who to reply to: guests type an email; account holders use their account email.
  if coalesce(p_contact_ok, false) then
    if v_guest then
      if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
        raise exception 'Please enter a valid email address so we can reply.';
      end if;
    else
      select lower(u.email) into v_email from auth.users u where u.id = v_uid;
    end if;
  else
    v_email := null;
  end if;

  select coalesce(nullif(p.display_name, ''), '') into v_name from public.profiles p where p.user_id = v_uid;

  if p_session_id is not null and exists (
    select 1 from public.participants pt where pt.session_id = p_session_id and pt.user_id = v_uid
  ) then
    v_session := p_session_id;
    select left(coalesce(s.title, ''), 120) into v_title from public.sessions s where s.id = p_session_id;
    -- At a table, the name people know them by there is the most useful one.
    select coalesce(nullif(pt.display_name, ''), v_name) into v_name
    from public.participants pt where pt.session_id = p_session_id and pt.user_id = v_uid;
  end if;

  insert into public.feedback (
    user_id, sender_name, sender_is_guest, contact_email, kind, category, message,
    page_path, session_id, table_title, user_agent
  ) values (
    v_uid, left(coalesce(v_name, ''), 60), v_guest, v_email, 'form', p_category, v_message,
    left(coalesce(p_page_path, ''), 200), v_session, coalesce(v_title, ''), left(coalesce(p_user_agent, ''), 300)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.submit_feedback(text, text, text, uuid, text, boolean, text) from public;
grant execute on function public.submit_feedback(text, text, text, uuid, text, boolean, text) to authenticated;
