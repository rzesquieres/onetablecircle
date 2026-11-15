-- OTC-27: editing an order.
--
-- What: who it's for (one person, or shared and by whom), how many, and the note.
--       Name, price and menu options stay as ordered (remove and re-add for those).
-- Who:  the person who added the item, or the table's creator (host). Same as
--       remove_order_item() (OTC-25).
-- When: until the bill is paid. If the bill was already sent but nobody has paid
--       yet, an edit takes the bill back (like reopen_bill) so the host can send
--       it again with the new split.
-- Tell: when the host edits someone else's item, that person gets an in-app
--       notification.
--
-- Editing now goes only through edit_order_item(), so the rules and the
-- notification can't be skipped. Deploy order: run this migration, then push the app.

-- New notification kind.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('order_removed', 'order_edited'));

create function public.edit_order_item(
  p_item_id uuid,
  p_quantity integer,
  p_notes text,
  p_is_shared boolean,
  p_assignee_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.order_items;
  v_session public.sessions;
  v_me public.participants;
  v_is_host boolean;
  v_ids uuid[];
  v_old_ids uuid[];
  v_notes text := left(coalesce(trim(p_notes), ''), 200);
  v_orderer_user uuid;
  v_label text;
  v_who text;
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
    raise exception 'The bill has been paid, so orders can''t be changed' using errcode = 'P0001';
  end if;

  -- Validate the new details.
  if p_quantity is null or p_quantity not between 1 and 99 then
    raise exception 'Quantity should be between 1 and 99' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_assignee_ids) as x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  if not coalesce(p_is_shared, false) and cardinality(v_ids) <> 1 then
    raise exception 'A non-shared item is for exactly one person' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as x
    where not exists (select 1 from public.participants where id = x and session_id = v_session.id)
  ) then
    raise exception 'That person is not at this table' using errcode = '22023';
  end if;

  -- Nothing changed: leave the bill alone and tell nobody.
  select coalesce(array_agg(participant_id order by participant_id), '{}') into v_old_ids
  from public.order_item_assignees where order_item_id = p_item_id;
  if v_item.quantity = p_quantity
     and v_item.notes = v_notes
     and v_item.is_shared = coalesce(p_is_shared, false)
     and v_old_ids = (select array_agg(x order by x) from unnest(v_ids) as x) then
    return;
  end if;

  -- The bill was sent but nobody has paid: take it back so it can be redone.
  if v_session.status = 'billing' then
    delete from public.payments where session_id = v_session.id;
    delete from public.bill_shares where session_id = v_session.id;
    update public.receipts set status = 'review', finalized_at = null, updated_at = now()
    where session_id = v_session.id and status = 'final';
    update public.sessions set status = 'closed' where id = v_session.id;
  end if;

  -- The quantity trigger still stops it dropping below what's been served.
  update public.order_items
  set quantity = p_quantity, notes = v_notes, is_shared = coalesce(p_is_shared, false)
  where id = p_item_id;

  -- Who it's for: drop people no longer on it, add new ones. People who stay
  -- keep their share weight.
  delete from public.order_item_assignees where order_item_id = p_item_id and participant_id <> all (v_ids);
  insert into public.order_item_assignees (order_item_id, participant_id)
  select p_item_id, x from unnest(v_ids) as x
  on conflict (order_item_id, participant_id) do nothing;

  -- The host changed someone else's item: tell them, in the app.
  if v_is_host and v_item.added_by <> v_me.id then
    select user_id into v_orderer_user from public.participants where id = v_item.added_by;
    if v_orderer_user is not null and v_orderer_user <> v_uid then
      v_label := case when p_quantity > 1 then p_quantity || '× ' else '' end || v_item.name;
      select string_agg(case when p.id = v_item.added_by then 'you' else p.display_name end, ', ' order by p.joined_at)
      into v_who
      from public.participants p where p.id = any (v_ids);
      insert into public.notifications (user_id, session_id, kind, body)
      values (
        v_orderer_user,
        v_session.id,
        'order_edited',
        left(format(
          '%s changed your order at %s: %s, %s %s.',
          v_me.display_name,
          v_session.title,
          v_label,
          case when coalesce(p_is_shared, false) then 'shared by' else 'for' end,
          v_who
        ), 500)
      );
    end if;
  end if;
end $$;
revoke execute on function public.edit_order_item(uuid, integer, text, boolean, uuid[]) from public, anon;
grant execute on function public.edit_order_item(uuid, integer, text, boolean, uuid[]) to authenticated;

-- add_order_item() ran as the caller and relied on the insert grants below.
-- Same function, now run as owner with the insert policy's checks written out,
-- so the direct grants can go.
create or replace function public.add_order_item(
  p_session_id uuid,
  p_name text,
  p_unit_price_centavos bigint,
  p_quantity integer,
  p_notes text,
  p_is_shared boolean,
  p_assignee_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_pid uuid := public.my_participant_id(p_session_id);
  v_ids uuid[] := array(select distinct x from unnest(p_assignee_ids) as x where x is not null);
  v_item uuid;
begin
  if v_pid is null then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  if not public.session_accepts_orders(p_session_id) then
    raise exception 'Ordering is closed for this table' using errcode = '42501';
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Choose who this item is for' using errcode = '22023';
  end if;
  if not p_is_shared and array_length(v_ids, 1) <> 1 then
    raise exception 'A non-shared item is for exactly one person' using errcode = '22023';
  end if;

  insert into public.order_items (session_id, added_by, name, unit_price_centavos, quantity, notes, is_shared)
  values (p_session_id, v_pid, trim(p_name), p_unit_price_centavos, p_quantity, coalesce(trim(p_notes), ''), p_is_shared)
  returning id into v_item;

  insert into public.order_item_assignees (order_item_id, participant_id)
  select v_item, x from unnest(v_ids) as x;

  return v_item;
end $$;

-- Direct edits are replaced by edit_order_item(); adding goes through
-- add_order_item() / add_menu_item(). Neither needs these grants.
drop policy order_items_update on public.order_items;
revoke update on public.order_items from authenticated;
drop policy assignees_insert on public.order_item_assignees;
drop policy assignees_delete on public.order_item_assignees;
revoke insert, delete on public.order_item_assignees from authenticated;
