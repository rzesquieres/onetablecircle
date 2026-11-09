-- OneTableCircle — Phase 5: receipt scan, bill split, settle up
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run it once, after the Phase 1–4 files.
--
-- Flow: host scans/enters the receipt (receipts + receipt_lines), links each
-- line to ordered items or to people, previews the split in the app, then
-- finalize_bill() stores everyone's share after checking the numbers add up
-- exactly to the receipt. People pay outside the app (GCash/Maya/cash), tap
-- "Paid", and the host confirms.

-- Composite keys so bill rows can only point at things in the same table/session.
alter table public.order_items add constraint order_items_id_session_key unique (id, session_id);
alter table public.participants add constraint participants_id_session_key unique (id, session_id);

-- =====================================================================
-- Payment QR on profiles (GCash / Maya image), shown to people at your tables
-- =====================================================================
alter table public.profiles
  add column payment_qr_path text,
  add column payment_qr_label text not null default '' check (char_length(payment_qr_label) <= 60);
grant update (payment_qr_path, payment_qr_label) on public.profiles to authenticated;

-- =====================================================================
-- Receipts
-- =====================================================================
create type public.receipt_status as enum ('scanning', 'review', 'failed', 'final');
create type public.line_split as enum ('items', 'people', 'everyone');

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  status public.receipt_status not null default 'review',
  image_paths text[] not null default '{}',
  -- Added on top of the item lines (VAT is usually already inside item prices in the Philippines).
  service_charge_centavos bigint not null default 0 check (service_charge_centavos >= 0),
  tax_centavos bigint not null default 0 check (tax_centavos >= 0),
  discount_centavos bigint not null default 0 check (discount_centavos >= 0),
  tip_centavos bigint not null default 0 check (tip_centavos >= 0),
  -- The total printed on the receipt, kept to check the lines against.
  printed_total_centavos bigint check (printed_total_centavos is null or printed_total_centavos >= 0),
  ai_output jsonb,
  error text,
  -- Copied from the host's profile when the bill is sent.
  payment_qr_path text,
  payment_qr_label text not null default '',
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, session_id)
);

create table public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  session_id uuid not null,
  description text not null check (char_length(trim(description)) between 1 and 120),
  quantity integer not null default 1 check (quantity between 1 and 999),
  amount_centavos bigint not null check (amount_centavos >= 0), -- line total
  split public.line_split not null default 'items',
  sort_order integer not null default 0,
  unique (id, session_id),
  foreign key (receipt_id, session_id) references public.receipts (id, session_id) on delete cascade
);
create index receipt_lines_session_idx on public.receipt_lines (session_id);

-- split = 'items': the ordered items this line pays for
create table public.receipt_line_items (
  receipt_line_id uuid not null,
  order_item_id uuid not null,
  session_id uuid not null,
  primary key (receipt_line_id, order_item_id),
  foreign key (receipt_line_id, session_id) references public.receipt_lines (id, session_id) on delete cascade,
  foreign key (order_item_id, session_id) references public.order_items (id, session_id) on delete cascade
);
create index receipt_line_items_session_idx on public.receipt_line_items (session_id);

-- split = 'people': who shares this line (e.g. corkage, an item nobody added)
create table public.receipt_line_people (
  receipt_line_id uuid not null,
  participant_id uuid not null,
  session_id uuid not null,
  weight integer not null default 1 check (weight between 1 and 100),
  primary key (receipt_line_id, participant_id),
  foreign key (receipt_line_id, session_id) references public.receipt_lines (id, session_id) on delete cascade,
  foreign key (participant_id, session_id) references public.participants (id, session_id) on delete cascade
);
create index receipt_line_people_session_idx on public.receipt_line_people (session_id);

-- Everyone's share, frozen when the host sends the bill.
create table public.bill_shares (
  session_id uuid not null references public.sessions (id) on delete cascade,
  participant_id uuid not null,
  items_centavos bigint not null check (items_centavos >= 0),
  service_centavos bigint not null check (service_centavos >= 0),
  tax_centavos bigint not null check (tax_centavos >= 0),
  discount_centavos bigint not null check (discount_centavos >= 0),
  tip_centavos bigint not null check (tip_centavos >= 0),
  total_centavos bigint not null check (total_centavos >= 0),
  breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(breakdown) = 'array'),
  primary key (session_id, participant_id),
  foreign key (participant_id, session_id) references public.participants (id, session_id) on delete cascade,
  check (total_centavos = items_centavos + service_centavos + tax_centavos + tip_centavos - discount_centavos)
);

create table public.payments (
  session_id uuid not null references public.sessions (id) on delete cascade,
  participant_id uuid not null,
  marked_paid_at timestamptz,
  marked_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  primary key (session_id, participant_id),
  foreign key (participant_id, session_id) references public.participants (id, session_id) on delete cascade
);

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table public.receipts enable row level security;
alter table public.receipt_lines enable row level security;
alter table public.receipt_line_items enable row level security;
alter table public.receipt_line_people enable row level security;
alter table public.bill_shares enable row level security;
alter table public.payments enable row level security;

revoke all on public.receipts, public.receipt_lines, public.receipt_line_items,
  public.receipt_line_people, public.bill_shares, public.payments from anon, authenticated;

-- Everyone at the table can see the receipt and the split.
grant select on public.receipts, public.receipt_lines, public.receipt_line_items,
  public.receipt_line_people, public.bill_shares, public.payments to authenticated;
create policy receipts_select on public.receipts for select to authenticated using (public.is_session_member(session_id));
create policy receipt_lines_select on public.receipt_lines for select to authenticated using (public.is_session_member(session_id));
create policy receipt_line_items_select on public.receipt_line_items for select to authenticated using (public.is_session_member(session_id));
create policy receipt_line_people_select on public.receipt_line_people for select to authenticated using (public.is_session_member(session_id));
create policy bill_shares_select on public.bill_shares for select to authenticated using (public.is_session_member(session_id));
create policy payments_select on public.payments for select to authenticated using (public.is_session_member(session_id));

-- Only the host edits the receipt, and only while it isn't final.
create function public.receipt_editable(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_session_host(p_session_id)
    and not exists (select 1 from public.receipts where session_id = p_session_id and status = 'final')
$$;
grant execute on function public.receipt_editable(uuid) to authenticated;

grant insert (session_id, status, image_paths), delete on public.receipts to authenticated;
grant update (status, image_paths, service_charge_centavos, tax_centavos, discount_centavos, tip_centavos,
  printed_total_centavos, ai_output, error, updated_at) on public.receipts to authenticated;
create policy receipts_insert on public.receipts for insert to authenticated
  with check (public.is_session_host(session_id) and status <> 'final');
create policy receipts_update on public.receipts for update to authenticated
  using (public.receipt_editable(session_id)) with check (public.receipt_editable(session_id) and status <> 'final');
create policy receipts_delete on public.receipts for delete to authenticated
  using (public.receipt_editable(session_id));

grant insert (receipt_id, session_id, description, quantity, amount_centavos, split, sort_order),
  update (description, quantity, amount_centavos, split, sort_order), delete on public.receipt_lines to authenticated;
create policy receipt_lines_write on public.receipt_lines for all to authenticated
  using (public.receipt_editable(session_id)) with check (public.receipt_editable(session_id));

grant insert (receipt_line_id, order_item_id, session_id), delete on public.receipt_line_items to authenticated;
create policy receipt_line_items_write on public.receipt_line_items for all to authenticated
  using (public.receipt_editable(session_id)) with check (public.receipt_editable(session_id));

grant insert (receipt_line_id, participant_id, session_id, weight), update (weight), delete
  on public.receipt_line_people to authenticated;
create policy receipt_line_people_write on public.receipt_line_people for all to authenticated
  using (public.receipt_editable(session_id)) with check (public.receipt_editable(session_id));

-- bill_shares and payments are written only through the functions below.

-- =====================================================================
-- Send the bill: store everyone's share after checking it adds up
-- p_shares: [{participant_id, items_centavos, service_centavos, tax_centavos,
--             discount_centavos, tip_centavos, total_centavos, breakdown}]
-- =====================================================================
create function public.finalize_bill(p_session_id uuid, p_shares jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_receipt public.receipts;
  v_lines bigint;
  v_host uuid := (select auth.uid());
  v_profile public.profiles;
  v_sum record;
begin
  if not public.is_session_host(p_session_id) then
    raise exception 'Only the host can send the bill' using errcode = '42501';
  end if;
  select * into v_receipt from public.receipts where session_id = p_session_id for update;
  if not found or v_receipt.status <> 'review' then
    raise exception 'The receipt isn''t ready to send' using errcode = '22023';
  end if;
  if jsonb_typeof(p_shares) <> 'array' then
    raise exception 'Bad bill data' using errcode = '22023';
  end if;

  select coalesce(sum(amount_centavos), 0) into v_lines from public.receipt_lines where receipt_id = v_receipt.id;
  if v_lines = 0 then
    raise exception 'Add the receipt items first' using errcode = '22023';
  end if;

  -- Every receipt line must say who pays for it.
  if exists (
    select 1 from public.receipt_lines l
    where l.receipt_id = v_receipt.id
      and ((l.split = 'items' and not exists (select 1 from public.receipt_line_items x where x.receipt_line_id = l.id))
        or (l.split = 'people' and not exists (select 1 from public.receipt_line_people x where x.receipt_line_id = l.id)))
  ) then
    raise exception 'Some receipt lines aren''t assigned to anyone yet' using errcode = '22023';
  end if;

  delete from public.payments where session_id = p_session_id;
  delete from public.bill_shares where session_id = p_session_id;

  -- Row checks (each share adds up; person is at this table) come from the
  -- table's constraints and foreign keys.
  insert into public.bill_shares (session_id, participant_id, items_centavos, service_centavos, tax_centavos,
    discount_centavos, tip_centavos, total_centavos, breakdown)
  select p_session_id, (s ->> 'participant_id')::uuid,
    (s ->> 'items_centavos')::bigint, (s ->> 'service_centavos')::bigint, (s ->> 'tax_centavos')::bigint,
    (s ->> 'discount_centavos')::bigint, (s ->> 'tip_centavos')::bigint, (s ->> 'total_centavos')::bigint,
    coalesce(s -> 'breakdown', '[]'::jsonb)
  from jsonb_array_elements(p_shares) as s;

  -- The shares must add up exactly to the receipt, part by part.
  select coalesce(sum(items_centavos), 0) as items, coalesce(sum(service_centavos), 0) as service,
    coalesce(sum(tax_centavos), 0) as tax, coalesce(sum(discount_centavos), 0) as discount,
    coalesce(sum(tip_centavos), 0) as tip
  into v_sum from public.bill_shares where session_id = p_session_id;
  if v_sum.items <> v_lines or v_sum.service <> v_receipt.service_charge_centavos
     or v_sum.tax <> v_receipt.tax_centavos or v_sum.discount <> v_receipt.discount_centavos
     or v_sum.tip <> v_receipt.tip_centavos then
    raise exception 'The shares don''t add up to the receipt. Please refresh and try again.' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where user_id = v_host;
  update public.receipts
  set status = 'final', finalized_at = now(), updated_at = now(),
      payment_qr_path = v_profile.payment_qr_path, payment_qr_label = coalesce(v_profile.payment_qr_label, '')
  where id = v_receipt.id;
  update public.sessions set status = 'billing', closed_at = coalesce(closed_at, now()) where id = p_session_id;
end $$;

-- Take the bill back to make changes (clears shares and payment marks).
create function public.reopen_bill(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_session_host(p_session_id) then
    raise exception 'Only the host can change the bill' using errcode = '42501';
  end if;
  delete from public.payments where session_id = p_session_id;
  delete from public.bill_shares where session_id = p_session_id;
  update public.receipts set status = 'review', finalized_at = null, updated_at = now()
  where session_id = p_session_id and status = 'final';
  update public.sessions set status = 'closed' where id = p_session_id and status in ('billing', 'settled');
end $$;

-- "I've paid" (by the person, or by the host on their behalf); untick allowed until confirmed.
create function public.mark_paid(p_session_id uuid, p_participant_id uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_part public.participants;
  v_host boolean := public.is_session_host(p_session_id);
begin
  select * into v_part from public.participants where id = p_participant_id and session_id = p_session_id;
  if not found or (v_part.user_id is distinct from v_uid and not v_host) then
    raise exception 'You can only mark your own payment' using errcode = '42501';
  end if;
  if v_part.is_host then
    raise exception 'The host doesn''t pay themselves' using errcode = '22023';
  end if;
  if not exists (select 1 from public.bill_shares where session_id = p_session_id and participant_id = p_participant_id and total_centavos > 0) then
    raise exception 'There''s nothing to pay yet' using errcode = '22023';
  end if;
  if p_paid then
    insert into public.payments (session_id, participant_id, marked_paid_at, marked_by)
    values (p_session_id, p_participant_id, now(), v_uid)
    on conflict (session_id, participant_id) do update set marked_paid_at = coalesce(public.payments.marked_paid_at, now()), marked_by = v_uid;
  else
    if not v_host and exists (select 1 from public.payments where session_id = p_session_id and participant_id = p_participant_id and confirmed_at is not null) then
      raise exception 'The host already confirmed this payment' using errcode = '22023';
    end if;
    delete from public.payments where session_id = p_session_id and participant_id = p_participant_id;
  end if;
end $$;

-- Host confirms money received (also marks paid, e.g. for cash).
create function public.confirm_payment(p_session_id uuid, p_participant_id uuid, p_confirmed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.is_session_host(p_session_id) then
    raise exception 'Only the host can confirm payments' using errcode = '42501';
  end if;
  if not exists (select 1 from public.bill_shares where session_id = p_session_id and participant_id = p_participant_id and total_centavos > 0) then
    raise exception 'There''s nothing to pay for this person' using errcode = '22023';
  end if;
  if p_confirmed then
    insert into public.payments (session_id, participant_id, marked_paid_at, marked_by, confirmed_at, confirmed_by)
    values (p_session_id, p_participant_id, now(), v_uid, now(), v_uid)
    on conflict (session_id, participant_id) do update
      set confirmed_at = now(), confirmed_by = v_uid,
          marked_paid_at = coalesce(public.payments.marked_paid_at, now()),
          marked_by = coalesce(public.payments.marked_by, v_uid);
  else
    update public.payments set confirmed_at = null, confirmed_by = null
    where session_id = p_session_id and participant_id = p_participant_id;
  end if;
end $$;

revoke execute on function public.finalize_bill(uuid, jsonb) from public, anon;
revoke execute on function public.reopen_bill(uuid) from public, anon;
revoke execute on function public.mark_paid(uuid, uuid, boolean) from public, anon;
revoke execute on function public.confirm_payment(uuid, uuid, boolean) from public, anon;
grant execute on function public.finalize_bill(uuid, jsonb) to authenticated;
grant execute on function public.reopen_bill(uuid) to authenticated;
grant execute on function public.mark_paid(uuid, uuid, boolean) to authenticated;
grant execute on function public.confirm_payment(uuid, uuid, boolean) to authenticated;

-- =====================================================================
-- Storage: receipt photos (private, table members can view) and payment
-- QR codes (public link with an unguessable name, owner manages).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-qr', 'payment-qr', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function public.folder_uuid(p_object_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end $$;
grant execute on function public.folder_uuid(text) to authenticated;

create policy receipts_files_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_session_member(public.folder_uuid(name)));
create policy receipts_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_session_host(public.folder_uuid(name)));
create policy receipts_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_session_host(public.folder_uuid(name)));

create policy payment_qr_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-qr' and public.folder_uuid(name) = (select auth.uid()));
create policy payment_qr_update on storage.objects for update to authenticated
  using (bucket_id = 'payment-qr' and public.folder_uuid(name) = (select auth.uid()))
  with check (bucket_id = 'payment-qr' and public.folder_uuid(name) = (select auth.uid()));
create policy payment_qr_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment-qr' and public.folder_uuid(name) = (select auth.uid()));

-- =====================================================================
-- Realtime: everyone sees the bill and payments update live
-- =====================================================================
alter table public.receipts replica identity full;
alter table public.bill_shares replica identity full;
alter table public.payments replica identity full;
alter publication supabase_realtime add table public.receipts, public.bill_shares, public.payments;
