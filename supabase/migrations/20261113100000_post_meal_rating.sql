-- OneTableCircle — post-meal rating (OTC-23)
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run this AFTER 20261113000000_feedback.sql, and BEFORE deploying the app code
-- that shows the rating prompt on the bill.
--
-- Once a table's bill is sent (receipt is final), each person at the table who
-- has the app open is asked once: "How did OneTableCircle work for your table?"
-- Ratings go into the feedback table (kind = 'post_meal') and show in the admin
-- Feedback inbox. Each person rates a table at most once; "Not now" is
-- remembered so the prompt doesn't come back.

-- One rating per person per table.
create unique index feedback_post_meal_once on public.feedback (session_id, user_id)
  where kind = 'post_meal' and session_id is not null and user_id is not null;
create index feedback_kind_time on public.feedback (kind, created_at desc);

-- People who tapped "Not now". Only read and written through the functions below.
create table public.post_meal_prompt_dismissals (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.post_meal_prompt_dismissals enable row level security;
revoke all on public.post_meal_prompt_dismissals from anon, authenticated;

-- True when the caller is at this table, its bill has been sent, and they
-- haven't rated it or said "Not now" yet.
create function public.post_meal_rating_due(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from public.participants pt where pt.session_id = p_session_id and pt.user_id = auth.uid())
    and exists (select 1 from public.receipts r where r.session_id = p_session_id and r.status = 'final')
    and not exists (
      select 1 from public.feedback f
      where f.session_id = p_session_id and f.user_id = auth.uid() and f.kind = 'post_meal'
    )
    and not exists (
      select 1 from public.post_meal_prompt_dismissals d where d.session_id = p_session_id and d.user_id = auth.uid()
    )
$$;

-- Records the caller's 1–5 star rating (and optional comment) for a table.
-- Ratings without a comment start as 'read', so the inbox's New tab holds only
-- things with something to read.
create function public.submit_post_meal_rating(
  p_session_id uuid,
  p_rating integer,
  p_message text default '',
  p_user_agent text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_message text := trim(coalesce(p_message, ''));
  v_name text;
  v_title text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Please pick 1 to 5 stars.';
  end if;
  if char_length(v_message) > 500 then
    raise exception 'Please keep your comment under 500 characters.';
  end if;

  select coalesce(nullif(pt.display_name, ''), '') into v_name
  from public.participants pt where pt.session_id = p_session_id and pt.user_id = v_uid;
  if not found then
    raise exception 'You can only rate a table you''re at.';
  end if;
  if not exists (select 1 from public.receipts r where r.session_id = p_session_id and r.status = 'final') then
    raise exception 'You can rate this table once the bill is sent.';
  end if;
  if exists (
    select 1 from public.feedback f where f.session_id = p_session_id and f.user_id = v_uid and f.kind = 'post_meal'
  ) then
    raise exception 'You''ve already rated this table. Thanks!';
  end if;

  select left(coalesce(s.title, ''), 120) into v_title from public.sessions s where s.id = p_session_id;

  insert into public.feedback (
    user_id, sender_name, sender_is_guest, kind, rating, message, page_path,
    session_id, table_title, user_agent, status
  ) values (
    v_uid, left(v_name, 60), public.is_anonymous_user(), 'post_meal', p_rating, v_message,
    '/s/' || p_session_id::text, p_session_id, coalesce(v_title, ''), left(coalesce(p_user_agent, ''), 300),
    case when v_message = '' then 'read' else 'new' end
  ) returning id into v_id;
  return v_id;
end;
$$;

-- "Not now": don't ask this person about this table again.
create function public.dismiss_post_meal_rating(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  if not exists (select 1 from public.participants pt where pt.session_id = p_session_id and pt.user_id = auth.uid()) then
    raise exception 'You can only rate a table you''re at.';
  end if;
  insert into public.post_meal_prompt_dismissals (session_id, user_id)
  values (p_session_id, auth.uid())
  on conflict do nothing;
end;
$$;

revoke execute on function public.post_meal_rating_due(uuid) from public;
revoke execute on function public.submit_post_meal_rating(uuid, integer, text, text) from public;
revoke execute on function public.dismiss_post_meal_rating(uuid) from public;
grant execute on function public.post_meal_rating_due(uuid) to authenticated;
grant execute on function public.submit_post_meal_rating(uuid, integer, text, text) to authenticated;
grant execute on function public.dismiss_post_meal_rating(uuid) to authenticated;
