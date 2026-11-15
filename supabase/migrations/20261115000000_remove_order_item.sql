-- OTC-25: removing an order.
--
-- Who:  the person who added the item, or the table's creator (host).
-- When: until the bill is paid. Once anyone has marked a payment, or the table
--       is settled, nothing can be removed (every share depends on every item).
--       If the bill was already sent but nobody has paid yet, removing an item
--       takes the bill back (like reopen_bill) so the host can send it again.
-- Tell: when the host removes someone else's item, that person gets an in-app
--       notification. No email.
--
-- Removing now goes only through remove_order_item(), so the rules and the
-- notification can't be skipped. Deploy order: run this migration, then push
-- the app (the old Remove button stops working until the new app is live).

-- =====================================================================
-- In-app notifications
-- =====================================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kept when the table is deleted later, so the message isn't lost.
  session_id uuid references public.sessions (id) on delete set null,
  kind text not null check (kind in ('order_removed')),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
-- You only see and dismiss your own. Notifications are written by the database.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;

-- =====================================================================
-- Removing an order item
-- =====================================================================

-- True once anyone at the table has marked a payment, or the table is settled.
create function public.bill_is_paid(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sessions where id = p_session_id and status = 'settled')
      or exists (select 1 from public.payments where session_id = p_session_id and marked_paid_at is not null)
$$;
revoke execute on function public.bill_is_paid(uuid) from public, anon;
grant execute on function public.bill_is_paid(uuid) to authenticated;

create function public.remove_order_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.order_items;
  v_session public.sessions;
  v_me public.participants;
  v_is_host boolean;
  v_orderer_user uuid;
  v_label text;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;

  select * into v_item from public.order_items where id = p_item_id;
  if not found then
    raise exception 'That item was already removed' using errcode = 'P0002';
  end if;
  -- Lock the table so a payment or a bill change can't slip in at the same time.
  select * into v_session from public.sessions where id = v_item.session_id for update;
  select * into v_me from public.participants where session_id = v_session.id and user_id = v_uid;
  if not found then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  v_is_host := v_session.host_id = v_uid;

  if not v_is_host and v_item.added_by <> v_me.id then
    raise exception 'Only the person who ordered it or the table''s creator can remove it' using errcode = '42501';
  end if;
  if public.bill_is_paid(v_session.id) then
    raise exception 'The bill has been paid, so orders can''t be removed' using errcode = 'P0001';
  end if;

  -- The bill was sent but nobody has paid: take it back so it can be redone.
  if v_session.status = 'billing' then
    delete from public.payments where session_id = v_session.id;
    delete from public.bill_shares where session_id = v_session.id;
    update public.receipts set status = 'review', finalized_at = null, updated_at = now()
    where session_id = v_session.id and status = 'final';
    update public.sessions set status = 'closed' where id = v_session.id;
  end if;

  delete from public.order_items where id = p_item_id;

  -- The host removed someone else's item: tell them, in the app.
  if v_is_host and v_item.added_by <> v_me.id then
    select user_id into v_orderer_user from public.participants where id = v_item.added_by;
    if v_orderer_user is not null and v_orderer_user <> v_uid then
      v_label := case when v_item.quantity > 1 then v_item.quantity || '× ' else '' end || v_item.name;
      insert into public.notifications (user_id, session_id, kind, body)
      values (
        v_orderer_user,
        v_session.id,
        'order_removed',
        left(format('%s removed your order: %s from %s.', v_me.display_name, v_label, v_session.title), 500)
      );
    end if;
  end if;
end $$;
revoke execute on function public.remove_order_item(uuid) from public, anon;
grant execute on function public.remove_order_item(uuid) to authenticated;

-- Direct deletes are replaced by remove_order_item(). Table deletes still
-- cascade to their items (foreign keys don't need this grant).
drop policy order_items_delete on public.order_items;
revoke delete on public.order_items from authenticated;
