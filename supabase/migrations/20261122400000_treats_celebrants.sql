-- OTC-33: "Libre" (someone covers another person's share) and celebrant mode
-- (the celebrant's share is spread evenly across everyone else).
--
--   participants.covered_by     who pays this person's share (null = themselves)
--   participants.is_celebrant   their share is spread across everyone else
--   bill_shares.covered_centavos   paid for this person by others
--   bill_shares.covering_centavos  this person pays for others
--   bill_shares.adjustments        [{participantId, amount, kind: treat|celebrant, direction: in|out}]
--
-- Who:  covering someone: the payer themselves ("I'll cover Ben") or the host.
--       Cancelling: the payer, or the host. Celebrant: the host only.
-- When: until the bill is paid; if the bill was sent but nobody has paid yet,
--       a change takes it back so the host can send it again.
--
-- Deploy order: run this migration, then push the app.

alter table public.participants
  add column covered_by uuid,
  add column is_celebrant boolean not null default false,
  add constraint participants_covered_by_fk foreign key (covered_by, session_id)
    references public.participants (id, session_id) on delete set null (covered_by),
  add constraint participants_not_self_covered check (covered_by is null or covered_by <> id);

alter table public.bill_shares
  add column covered_centavos bigint not null default 0 check (covered_centavos >= 0),
  add column covering_centavos bigint not null default 0 check (covering_centavos >= 0),
  add column adjustments jsonb not null default '[]'::jsonb check (jsonb_typeof(adjustments) = 'array');
alter table public.bill_shares drop constraint bill_shares_total_adds_up;
alter table public.bill_shares add constraint bill_shares_total_adds_up check (
  total_centavos = items_centavos + service_centavos + tax_centavos + tip_centavos
    - discount_centavos - sc_pwd_discount_centavos - covered_centavos + covering_centavos
);

-- ---------------------------------------------------------------------
-- Shared helper: a bill that was sent but not paid goes back to the host.
-- ---------------------------------------------------------------------
create function public.take_bill_back_if_sent(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.sessions where id = p_session_id and status = 'billing') then
    delete from public.payments where session_id = p_session_id;
    delete from public.bill_shares where session_id = p_session_id;
    update public.receipts set status = 'review', finalized_at = null, updated_at = now()
    where session_id = p_session_id and status = 'final';
    update public.sessions set status = 'closed' where id = p_session_id;
  end if;
end $$;
revoke execute on function public.take_bill_back_if_sent(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Covering people ("libre")
-- ---------------------------------------------------------------------
create function public.set_covered_by(p_participant_ids uuid[], p_payer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session_id uuid;
  v_session public.sessions;
  v_me public.participants;
  v_payer public.participants;
  v_is_host boolean;
  v_target public.participants;
  v_cursor uuid;
  v_steps integer;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;
  if p_participant_ids is null or cardinality(p_participant_ids) = 0 then
    raise exception 'Choose who to cover' using errcode = '22023';
  end if;
  if cardinality(p_participant_ids) > 50 then
    raise exception 'Too many people' using errcode = '22023';
  end if;

  select session_id into v_session_id from public.participants where id = p_participant_ids[1];
  if v_session_id is null then
    raise exception 'That person isn''t at this table' using errcode = 'P0002';
  end if;
  select * into v_session from public.sessions where id = v_session_id for update;
  select * into v_me from public.participants where session_id = v_session.id and user_id = v_uid;
  if not found then
    raise exception 'You are not part of this table' using errcode = '42501';
  end if;
  v_is_host := v_session.host_id = v_uid;
  if (select count(*) from public.participants where id = any (p_participant_ids) and session_id = v_session.id)
     <> cardinality(array(select distinct unnest(p_participant_ids))) then
    raise exception 'Everyone must be at this table' using errcode = '22023';
  end if;
  if public.bill_is_paid(v_session.id) then
    raise exception 'The bill has been paid, so this can''t be changed' using errcode = 'P0001';
  end if;

  if p_payer is not null then
    select * into v_payer from public.participants where id = p_payer and session_id = v_session.id;
    if not found then
      raise exception 'The person paying must be at this table' using errcode = '22023';
    end if;
    if not v_is_host and v_payer.id <> v_me.id then
      raise exception 'You can only offer to cover people yourself' using errcode = '42501';
    end if;
    if v_payer.is_celebrant then
      raise exception 'The celebrant can''t cover others' using errcode = '22023';
    end if;
    if p_payer = any (p_participant_ids) then
      raise exception 'Someone can''t cover themselves' using errcode = '22023';
    end if;
    -- No loops: whoever pays for the payer can't be one of the people being covered.
    v_cursor := v_payer.covered_by;
    v_steps := 0;
    while v_cursor is not null and v_steps < 100 loop
      if v_cursor = any (p_participant_ids) then
        raise exception 'That would make a loop of people covering each other' using errcode = '22023';
      end if;
      select covered_by into v_cursor from public.participants where id = v_cursor;
      v_steps := v_steps + 1;
    end loop;
  end if;

  for v_target in select * from public.participants where id = any (p_participant_ids) loop
    if p_payer is not null and v_target.is_celebrant then
      raise exception '% is the celebrant, so everyone already covers them', v_target.display_name using errcode = '22023';
    end if;
    -- Cancelling: the person currently paying, or the host. Covering: replaces
    -- someone else's offer only if you're the host.
    if not v_is_host and v_target.covered_by is not null and v_target.covered_by <> v_me.id then
      raise exception '% is already covered by someone else', v_target.display_name using errcode = '42501';
    end if;
  end loop;

  perform public.take_bill_back_if_sent(v_session.id);
  update public.participants set covered_by = p_payer
  where id = any (p_participant_ids) and covered_by is distinct from p_payer;
end $$;
revoke execute on function public.set_covered_by(uuid[], uuid) from public, anon;
grant execute on function public.set_covered_by(uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Celebrant
-- ---------------------------------------------------------------------
create function public.set_celebrant(p_participant_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.participants;
begin
  select * into v_target from public.participants where id = p_participant_id;
  if not found then
    raise exception 'That person isn''t at this table' using errcode = 'P0002';
  end if;
  perform 1 from public.sessions where id = v_target.session_id for update;
  if not public.is_session_host(v_target.session_id) then
    raise exception 'Only the table''s creator can choose the celebrant' using errcode = '42501';
  end if;
  if public.bill_is_paid(v_target.session_id) then
    raise exception 'The bill has been paid, so this can''t be changed' using errcode = 'P0001';
  end if;
  if v_target.is_celebrant = coalesce(p_on, false) then
    return;
  end if;
  if p_on and exists (select 1 from public.participants where covered_by = v_target.id) then
    raise exception '% is covering others. Cancel that first.', v_target.display_name using errcode = '22023';
  end if;

  perform public.take_bill_back_if_sent(v_target.session_id);
  update public.participants
  set is_celebrant = coalesce(p_on, false), covered_by = case when p_on then null else covered_by end
  where id = v_target.id;
end $$;
revoke execute on function public.set_celebrant(uuid, boolean) from public, anon;
grant execute on function public.set_celebrant(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- finalize_bill: as before, plus treats and celebrants must balance and
-- only go to people who are covered or celebrating.
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
    discount_centavos, sc_pwd_discount_centavos, tip_centavos, covered_centavos, covering_centavos,
    total_centavos, breakdown, adjustments)
  select p_session_id, (s ->> 'participant_id')::uuid,
    (s ->> 'items_centavos')::bigint, (s ->> 'service_centavos')::bigint, (s ->> 'tax_centavos')::bigint,
    (s ->> 'discount_centavos')::bigint, coalesce((s ->> 'sc_pwd_discount_centavos')::bigint, 0),
    (s ->> 'tip_centavos')::bigint,
    coalesce((s ->> 'covered_centavos')::bigint, 0), coalesce((s ->> 'covering_centavos')::bigint, 0),
    (s ->> 'total_centavos')::bigint,
    coalesce(s -> 'breakdown', '[]'::jsonb), coalesce(s -> 'adjustments', '[]'::jsonb)
  from jsonb_array_elements(p_shares) as s;

  if exists (
    select 1 from public.bill_shares b join public.participants p on p.id = b.participant_id
    where b.session_id = p_session_id and b.sc_pwd_discount_centavos > 0 and p.sc_pwd is null
  ) then
    raise exception 'The Senior/PWD discount can only go to people marked Senior or PWD' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.bill_shares b join public.participants p on p.id = b.participant_id
    where b.session_id = p_session_id and b.covered_centavos > 0 and p.covered_by is null and not p.is_celebrant
  ) then
    raise exception 'Only people who are covered or celebrating can have their share paid by others' using errcode = '22023';
  end if;

  select coalesce(sum(items_centavos), 0) as items, coalesce(sum(service_centavos), 0) as service,
    coalesce(sum(tax_centavos), 0) as tax, coalesce(sum(discount_centavos), 0) as discount,
    coalesce(sum(sc_pwd_discount_centavos), 0) as sc_pwd, coalesce(sum(tip_centavos), 0) as tip,
    coalesce(sum(covered_centavos), 0) as covered, coalesce(sum(covering_centavos), 0) as covering
  into v_sum from public.bill_shares where session_id = p_session_id;
  if v_sum.items <> v_lines or v_sum.service <> v_receipt.service_charge_centavos
     or v_sum.tax <> v_receipt.tax_centavos or v_sum.discount <> v_receipt.discount_centavos
     or v_sum.sc_pwd <> v_receipt.sc_pwd_discount_centavos
     or v_sum.tip <> v_receipt.tip_centavos
     or v_sum.covered <> v_sum.covering then
    raise exception 'The shares don''t add up to the receipt. Please refresh and try again.' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where user_id = v_host;
  update public.receipts
  set status = 'final', finalized_at = now(), updated_at = now(),
      payment_qr_path = v_profile.payment_qr_path, payment_qr_label = coalesce(v_profile.payment_qr_label, '')
  where id = v_receipt.id;
  update public.sessions set status = 'billing', closed_at = coalesce(closed_at, now()) where id = p_session_id;
end $$;
