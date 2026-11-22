-- OTC-32: change who shares an item, and how many portions each person has.
--
-- set_item_sharing(item, people) replaces an item's assignees in one step.
-- `people` is a JSON array of {"participant_id": uuid, "weight": 1..10}.
-- One person = not shared; two or more = shared (split by weight, even if all 1).
--
-- Who:  the person who added the item, or the table's creator (host). Same rule
--       as removing an item (OTC-25).
-- When: until the bill is paid. If the bill was sent but nobody has paid yet,
--       changing the split takes the bill back so the host can send it again.
--
-- Deploy order: run this migration, then push the app.

create function public.set_item_sharing(p_item_id uuid, p_people jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.order_items;
  v_session public.sessions;
  v_me public.participants;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;

  select * into v_item from public.order_items where id = p_item_id;
  if not found then
    raise exception 'That item was removed' using errcode = 'P0002';
  end if;
  select * into v_session from public.sessions where id = v_item.session_id for update;
  select * into v_me from public.participants where session_id = v_session.id and user_id = v_uid;
  if not found then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  if v_session.host_id <> v_uid and v_item.added_by <> v_me.id then
    raise exception 'Only the person who ordered it or the table''s creator can change who shares it' using errcode = '42501';
  end if;
  if public.bill_is_paid(v_session.id) then
    raise exception 'The bill has been paid, so items can''t be changed' using errcode = 'P0001';
  end if;

  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
    raise exception 'Choose at least one person' using errcode = '22023';
  end if;
  if jsonb_array_length(p_people) > 50 then
    raise exception 'Too many people' using errcode = '22023';
  end if;

  create temp table _people on commit drop as
    select (x ->> 'participant_id')::uuid as participant_id, coalesce((x ->> 'weight')::integer, 1) as weight
    from jsonb_array_elements(p_people) x;

  if exists (select 1 from _people where participant_id is null or weight not between 1 and 10) then
    raise exception 'Each person needs between 1 and 10 portions' using errcode = '22023';
  end if;
  if (select count(*) from _people) <> (select count(distinct participant_id) from _people) then
    raise exception 'Someone is listed twice' using errcode = '22023';
  end if;
  if exists (
    select 1 from _people p
    where not exists (select 1 from public.participants x where x.id = p.participant_id and x.session_id = v_session.id)
  ) then
    raise exception 'Everyone must be at this table' using errcode = '22023';
  end if;
  select count(*) into v_count from _people;

  -- The bill was sent but nobody has paid: take it back so it can be redone.
  if v_session.status = 'billing' then
    delete from public.payments where session_id = v_session.id;
    delete from public.bill_shares where session_id = v_session.id;
    update public.receipts set status = 'review', finalized_at = null, updated_at = now()
    where session_id = v_session.id and status = 'final';
    update public.sessions set status = 'closed' where id = v_session.id;
  end if;

  delete from public.order_item_assignees where order_item_id = p_item_id;
  insert into public.order_item_assignees (order_item_id, participant_id, share_weight)
  select p_item_id, participant_id, weight from _people;
  update public.order_items set is_shared = v_count > 1 where id = p_item_id;

  drop table _people;
end $$;
revoke execute on function public.set_item_sharing(uuid, jsonb) from public, anon;
grant execute on function public.set_item_sharing(uuid, jsonb) to authenticated;
