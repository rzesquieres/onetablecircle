-- OneTableCircle — OTC-11: anyone at the table can add someone without a phone
--
-- Until now only the host could add a person by name. This lets any member
-- (including a quick guest who joined by link) add one, so they can order
-- for a friend who isn't using the app. It also:
--   * records who added each person (participants.added_by),
--   * lets that member remove the person again while they have no items,
--   * caps a table at 30 people, so a shared link can't be used to flood it.

alter table public.participants
  add column added_by uuid references public.participants (id) on delete set null;

-- True when someone has at least one item ordered for them.
create function public.participant_has_items(p_participant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.order_item_assignees where participant_id = p_participant_id)
$$;
revoke execute on function public.participant_has_items(uuid) from public, anon;
grant execute on function public.participant_has_items(uuid) to authenticated;

-- Add a person without a phone. Members can do this while ordering is open;
-- the host also until billing starts (as before). Returns the new person's id.
create function public.add_offline_person(p_session_id uuid, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_pid uuid := public.my_participant_id(p_session_id);
  v_name text := left(trim(coalesce(p_display_name, '')), 40);
  v_new uuid;
begin
  if v_pid is null then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  if not (
    public.session_accepts_orders(p_session_id)
    or (public.is_session_host(p_session_id) and public.session_is_active(p_session_id))
  ) then
    raise exception 'Ordering is closed for this table' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Type their name' using errcode = '22023';
  end if;

  -- Lock the table row so two people adding at once can't pass the cap together.
  perform 1 from public.sessions where id = p_session_id for update;
  if (select count(*) from public.participants where session_id = p_session_id) >= 30 then
    raise exception 'This table is full (30 people)' using errcode = 'P0001';
  end if;

  insert into public.participants (session_id, display_name, added_by)
  values (p_session_id, v_name, v_pid)
  returning id into v_new;
  return v_new;
end $$;
revoke execute on function public.add_offline_person(uuid, text) from public, anon;
grant execute on function public.add_offline_person(uuid, text) to authenticated;

-- Whoever added a person can remove them again, while ordering is open and
-- nothing has been ordered for them. (The host keeps participants_delete.)
create policy participants_delete_added on public.participants for delete to authenticated
  using (
    user_id is null
    and not is_host
    and added_by = public.my_participant_id(session_id)
    and public.session_accepts_orders(session_id)
    and not public.participant_has_items(id)
  );
