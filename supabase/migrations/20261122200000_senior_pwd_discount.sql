-- OTC-31: Senior Citizen / PWD discount goes only to the people who have the ID.
--
-- Until now the receipt had one "discount" amount, split across everyone in
-- proportion to what they ate. A Senior/PWD discount (VAT removed, then 20% off,
-- on the cardholder's own food) must go only to the cardholders.
--
--   participants.sc_pwd                    'senior' | 'pwd' | null
--   receipts.sc_pwd_discount_centavos      the Senior/PWD discount on the receipt
--                                          (VAT exemption + 20%), apart from promos
--   bill_shares.sc_pwd_discount_centavos   each person's part of it
--
-- Who marks someone: the host, the person themselves, or whoever added them
-- (people without a phone). Until the bill is paid; if the bill was sent but
-- nobody has paid, the change takes it back so the host can send it again.
--
-- Deploy order: run this migration, then push the app.

alter table public.participants
  add column sc_pwd text check (sc_pwd in ('senior', 'pwd'));

alter table public.receipts
  add column sc_pwd_discount_centavos bigint not null default 0 check (sc_pwd_discount_centavos >= 0);
grant update (sc_pwd_discount_centavos) on public.receipts to authenticated;

alter table public.bill_shares
  add column sc_pwd_discount_centavos bigint not null default 0 check (sc_pwd_discount_centavos >= 0);

-- Replace the "total adds up" check so it includes the new discount.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.bill_shares'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%total_centavos = %'
  loop
    execute format('alter table public.bill_shares drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.bill_shares add constraint bill_shares_total_adds_up check (
  total_centavos = items_centavos + service_centavos + tax_centavos + tip_centavos - discount_centavos - sc_pwd_discount_centavos
);

-- ---------------------------------------------------------------------
-- Marking someone as Senior / PWD
-- ---------------------------------------------------------------------
create function public.set_sc_pwd(p_participant_id uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_target public.participants;
  v_session public.sessions;
  v_me public.participants;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;
  if p_kind is not null and p_kind not in ('senior', 'pwd') then
    raise exception 'Choose Senior or PWD' using errcode = '22023';
  end if;

  select * into v_target from public.participants where id = p_participant_id;
  if not found then
    raise exception 'That person isn''t at this table' using errcode = 'P0002';
  end if;
  select * into v_session from public.sessions where id = v_target.session_id for update;
  select * into v_me from public.participants where session_id = v_session.id and user_id = v_uid;
  if not found then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  if v_session.host_id <> v_uid and v_target.id <> v_me.id and v_target.added_by is distinct from v_me.id then
    raise exception 'Only the table''s creator or the person themselves can change this' using errcode = '42501';
  end if;
  if public.bill_is_paid(v_session.id) then
    raise exception 'The bill has been paid, so this can''t be changed' using errcode = 'P0001';
  end if;
  if v_target.sc_pwd is not distinct from p_kind then
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

  update public.participants set sc_pwd = p_kind where id = v_target.id;
end $$;
revoke execute on function public.set_sc_pwd(uuid, text) from public, anon;
grant execute on function public.set_sc_pwd(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- finalize_bill: same as before, plus the Senior/PWD discount must add up
-- and may only go to people marked Senior or PWD.
-- ---------------------------------------------------------------------
create or replace function public.finalize_bill(p_session_id uuid, p_shares jsonb) returns void
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

  insert into public.bill_shares (session_id, participant_id, items_centavos, service_centavos, tax_centavos,
    discount_centavos, sc_pwd_discount_centavos, tip_centavos, total_centavos, breakdown)
  select p_session_id, (s ->> 'participant_id')::uuid,
    (s ->> 'items_centavos')::bigint, (s ->> 'service_centavos')::bigint, (s ->> 'tax_centavos')::bigint,
    (s ->> 'discount_centavos')::bigint, coalesce((s ->> 'sc_pwd_discount_centavos')::bigint, 0),
    (s ->> 'tip_centavos')::bigint, (s ->> 'total_centavos')::bigint,
    coalesce(s -> 'breakdown', '[]'::jsonb)
  from jsonb_array_elements(p_shares) as s;

  -- The Senior/PWD discount only goes to people marked Senior or PWD.
  if exists (
    select 1 from public.bill_shares b join public.participants p on p.id = b.participant_id
    where b.session_id = p_session_id and b.sc_pwd_discount_centavos > 0 and p.sc_pwd is null
  ) then
    raise exception 'The Senior/PWD discount can only go to people marked Senior or PWD' using errcode = '22023';
  end if;

  -- The shares must add up exactly to the receipt, part by part.
  select coalesce(sum(items_centavos), 0) as items, coalesce(sum(service_centavos), 0) as service,
    coalesce(sum(tax_centavos), 0) as tax, coalesce(sum(discount_centavos), 0) as discount,
    coalesce(sum(sc_pwd_discount_centavos), 0) as sc_pwd, coalesce(sum(tip_centavos), 0) as tip
  into v_sum from public.bill_shares where session_id = p_session_id;
  if v_sum.items <> v_lines or v_sum.service <> v_receipt.service_charge_centavos
     or v_sum.tax <> v_receipt.tax_centavos or v_sum.discount <> v_receipt.discount_centavos
     or v_sum.sc_pwd <> v_receipt.sc_pwd_discount_centavos
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
