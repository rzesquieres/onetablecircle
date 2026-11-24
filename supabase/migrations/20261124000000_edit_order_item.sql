-- OTC-27: edit an order after it's placed.
--
-- edit_order_item(item, quantity, notes, people) changes an item's quantity,
-- notes and who shares it (with portions) in one step. `people` is the same
-- JSON array as set_item_sharing (OTC-32): [{"participant_id": uuid, "weight": 1..10}].
-- Pass null for `people` to keep the current sharing.
--
-- Who:  the person who added the item, or the table's creator (host).
-- When: until the bill is paid. If the bill was sent but nobody has paid yet,
--       a change takes the bill back so the host can send it again.
-- Tell: when the host changes someone else's item, that person gets an in-app
--       notification saying what changed (like removing, OTC-25).
--
-- Editing now goes only through these functions, so the rules and the
-- notification can't be skipped: direct updates of order_items are revoked.
-- Deploy order: run this migration, then push the app.

-- An earlier draft of OTC-27 (PR #19, never merged) had its own migration. In case
-- it was run in the SQL Editor, drop its function and keep its notifications valid.
drop function if exists public.edit_order_item(uuid, integer, text, boolean, uuid[]);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('order_removed', 'order_changed', 'order_edited'));

create function public.edit_order_item(p_item_id uuid, p_quantity integer, p_notes text, p_people jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.order_items;
  v_session public.sessions;
  v_me public.participants;
  v_is_host boolean;
  v_notes text := left(coalesce(trim(p_notes), ''), 200);
  v_people jsonb;
  v_old_people jsonb;
  v_changes text[] := '{}';
  v_orderer_user uuid;
  v_label text;
  v_names text;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;

  select * into v_item from public.order_items where id = p_item_id;
  if not found then
    raise exception 'That item was removed' using errcode = 'P0002';
  end if;
  -- Lock the table so a payment or a bill change can't slip in at the same time.
  select * into v_session from public.sessions where id = v_item.session_id for update;
  select * into v_me from public.participants where session_id = v_session.id and user_id = v_uid;
  if not found then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  v_is_host := v_session.host_id = v_uid;
  if not v_is_host and v_item.added_by <> v_me.id then
    raise exception 'Only the person who ordered it or the table''s creator can change it' using errcode = '42501';
  end if;
  if public.bill_is_paid(v_session.id) then
    raise exception 'The bill has been paid, so items can''t be changed' using errcode = 'P0001';
  end if;

  if p_quantity is null or p_quantity not between 1 and 99 then
    raise exception 'Quantity must be between 1 and 99' using errcode = '22023';
  end if;

  -- Current sharing, in the same shape as p_people, sorted for comparing.
  select coalesce(jsonb_agg(jsonb_build_object('participant_id', participant_id, 'weight', share_weight)
                            order by participant_id), '[]'::jsonb)
    into v_old_people
  from public.order_item_assignees where order_item_id = p_item_id;

  if p_people is null then
    v_people := v_old_people;
  else
    if jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
      raise exception 'Choose at least one person' using errcode = '22023';
    end if;
    if jsonb_array_length(p_people) > 50 then
      raise exception 'Too many people' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_people) x
      where (x ->> 'participant_id') is null
         or coalesce((x ->> 'weight')::integer, 1) not between 1 and 10
    ) then
      raise exception 'Each person needs between 1 and 10 portions' using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object('participant_id', pid, 'weight', w) order by pid)
      into v_people
    from (
      select (x ->> 'participant_id')::uuid as pid, coalesce((x ->> 'weight')::integer, 1) as w
      from jsonb_array_elements(p_people) x
    ) s;
    if (select count(distinct (x ->> 'participant_id')) from jsonb_array_elements(p_people) x) <> jsonb_array_length(p_people) then
      raise exception 'Someone is listed twice' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_people) x
      where not exists (
        select 1 from public.participants p
        where p.id = (x ->> 'participant_id')::uuid and p.session_id = v_session.id
      )
    ) then
      raise exception 'Everyone must be at this table' using errcode = '22023';
    end if;
    -- One person never has "portions": store weight 1, like the app does.
    if jsonb_array_length(v_people) = 1 then
      v_people := jsonb_build_array(jsonb_set(v_people -> 0, '{weight}', '1'));
    end if;
  end if;

  -- What actually changed (also the wording of the notification).
  if p_quantity <> v_item.quantity then
    v_changes := v_changes || format('quantity %s → %s', v_item.quantity, p_quantity);
  end if;
  if v_notes <> v_item.notes then
    v_changes := v_changes || case when v_notes = '' then 'note removed' else format('note: "%s"', v_notes) end;
  end if;
  if v_people <> v_old_people then
    select string_agg(p.display_name, ', ' order by p.display_name) into v_names
    from jsonb_array_elements(v_people) x
    join public.participants p on p.id = (x ->> 'participant_id')::uuid;
    v_changes := v_changes || case
      when jsonb_array_length(v_people) > 1 then format('now shared by %s', v_names)
      else format('now for %s', v_names)
    end;
  end if;

  if cardinality(v_changes) = 0 then
    return; -- nothing to save
  end if;

  -- The bill was sent but nobody has paid: take it back so it can be redone.
  if v_session.status = 'billing' then
    delete from public.payments where session_id = v_session.id;
    delete from public.bill_shares where session_id = v_session.id;
    update public.receipts set status = 'review', finalized_at = null, updated_at = now()
    where session_id = v_session.id and status = 'final';
    update public.sessions set status = 'closed' where id = v_session.id;
  end if;

  -- The quantity trigger still stops going below what's already been served.
  update public.order_items
  set quantity = p_quantity,
      notes = v_notes,
      is_shared = jsonb_array_length(v_people) > 1
  where id = p_item_id;

  if v_people <> v_old_people then
    delete from public.order_item_assignees where order_item_id = p_item_id;
    insert into public.order_item_assignees (order_item_id, participant_id, share_weight)
    select p_item_id, (x ->> 'participant_id')::uuid, (x ->> 'weight')::integer
    from jsonb_array_elements(v_people) x;
  end if;

  -- The host changed someone else's item: tell them, in the app.
  if v_is_host and v_item.added_by <> v_me.id then
    select user_id into v_orderer_user from public.participants where id = v_item.added_by;
    if v_orderer_user is not null and v_orderer_user <> v_uid then
      v_label := case when v_item.quantity > 1 then v_item.quantity || '× ' else '' end || v_item.name;
      insert into public.notifications (user_id, session_id, kind, body)
      values (
        v_orderer_user,
        v_session.id,
        'order_changed',
        left(format('%s changed your order of %s at %s: %s.',
          v_me.display_name, v_label, v_session.title, array_to_string(v_changes, '; ')), 500)
      );
    end if;
  end if;
end $$;
revoke execute on function public.edit_order_item(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.edit_order_item(uuid, integer, text, jsonb) to authenticated;

-- set_item_sharing (OTC-32) now goes through edit_order_item, so it follows the
-- same rules and also notifies. Same signature, so existing callers keep working.
create or replace function public.set_item_sharing(p_item_id uuid, p_people jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.order_items;
begin
  if p_people is null then
    raise exception 'Choose at least one person' using errcode = '22023';
  end if;
  select * into v_item from public.order_items where id = p_item_id;
  if not found then
    raise exception 'That item was removed' using errcode = 'P0002';
  end if;
  perform public.edit_order_item(p_item_id, v_item.quantity, v_item.notes, p_people);
end $$;

-- Changing an item now goes only through edit_order_item / set_item_sharing.
drop policy if exists order_items_update on public.order_items;
revoke update on public.order_items from authenticated;
