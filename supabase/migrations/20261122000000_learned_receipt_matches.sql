-- OneTableCircle — OTC-29: learn from the host's receipt matching
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run it once, before deploying the app code that uses it.
--
-- When the host sends a bill, every receipt line that pays for ordered items
-- teaches the store: "this receipt text means that item". The next receipt
-- scanned at the same store uses what was learned before guessing by name.
--
-- Learning is per store (receipt abbreviations differ between restaurants)
-- and shared by every host at that store. Each sent receipt casts one vote
-- per (receipt text, item): +1 for the items the line was matched to, -1 for
-- an item that was learned for that text before but wasn't picked this time
-- (the host corrected it). Taking a bill back and sending it again replaces
-- that receipt's votes, so it never counts twice.

-- Receipt text as a lookup key: lower case, accents and punctuation removed,
-- a leading quantity ("2 ", "2x ") dropped. Same rules as receiptTextKey() in
-- src/lib/bill.ts.
create function public.receipt_text_key(p_text text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    trim(regexp_replace(
      lower(regexp_replace(normalize(coalesce(p_text, ''), NFKD), '[\u0300-\u036f]', '', 'g')),
      '[^a-z0-9]+', ' ', 'g')),
    '^[0-9]+ ?x? ', '')
$$;
grant execute on function public.receipt_text_key(text) to authenticated;

-- What a line was matched to: the menu item ("menu:<uuid>") or, for typed-in
-- orders, the order's name ("name:<key>"). Same as matchTarget() in src/lib/bill.ts.
create function public.order_item_match_target(p_menu_item_id uuid, p_name text) returns text
language sql immutable set search_path = '' as $$
  select case when p_menu_item_id is not null then 'menu:' || p_menu_item_id::text
              else 'name:' || public.receipt_text_key(p_name) end
$$;
grant execute on function public.order_item_match_target(uuid, text) to authenticated;

create table public.receipt_match_votes (
  -- No foreign key: learning stays after the table (session) is deleted.
  receipt_id uuid not null,
  store_id uuid not null references public.stores (id) on delete cascade,
  text_key text not null check (char_length(text_key) between 1 and 120),
  target text not null check (char_length(target) between 6 and 140),
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (receipt_id, text_key, target)
);
create index receipt_match_votes_lookup_idx on public.receipt_match_votes (store_id, text_key);

-- Written only by the trigger below; read only through learned_receipt_matches().
alter table public.receipt_match_votes enable row level security;
revoke all on public.receipt_match_votes from anon, authenticated;

-- How each ordered item got onto a receipt line, so the app can show
-- "learned" matches for the host to check.
alter table public.receipt_line_items
  add column source text not null default 'manual' check (source in ('manual', 'auto', 'learned'));
grant insert (source) on public.receipt_line_items to authenticated;

-- What the store has learned: only (text, item) pairs with more confirmations
-- than corrections.
create function public.store_learned_matches(p_store_id uuid)
returns table (text_key text, target text, score integer)
language sql stable security definer set search_path = '' as $$
  select v.text_key, v.target, sum(v.vote)::integer as score
  from public.receipt_match_votes v
  where v.store_id = p_store_id
  group by v.text_key, v.target
  having sum(v.vote) > 0
$$;
revoke execute on function public.store_learned_matches(uuid) from public, anon, authenticated;

-- For the receipt scan: what the host's store has learned. Host only.
create function public.learned_receipt_matches(p_session_id uuid)
returns table (text_key text, target text, score integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_store uuid;
begin
  if not public.is_session_host(p_session_id) then
    raise exception 'Only the host can scan the receipt' using errcode = '42501';
  end if;
  select store_id into v_store from public.sessions where id = p_session_id;
  if v_store is null then
    return;
  end if;
  return query select m.text_key, m.target, m.score from public.store_learned_matches(v_store) m;
end $$;
revoke execute on function public.learned_receipt_matches(uuid) from public, anon;
grant execute on function public.learned_receipt_matches(uuid) to authenticated;

-- Learn when the bill is sent.
create function public.learn_receipt_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_store uuid;
begin
  select store_id into v_store from public.sessions where id = new.session_id;
  -- Replace this receipt's earlier votes (bill taken back and sent again).
  delete from public.receipt_match_votes where receipt_id = new.id;
  if v_store is null then
    return new;
  end if;

  with picked as (
    select distinct public.receipt_text_key(l.description) as text_key,
      public.order_item_match_target(o.menu_item_id, o.name) as target
    from public.receipt_lines l
    join public.receipt_line_items x on x.receipt_line_id = l.id
    join public.order_items o on o.id = x.order_item_id
    where l.receipt_id = new.id and l.split = 'items'
  ),
  keys as (
    select distinct text_key from picked where text_key <> ''
  ),
  -- Items learned for the same text before, that the host didn't pick now.
  corrected as (
    select m.text_key, m.target
    from keys k
    cross join lateral public.store_learned_matches(v_store) m
    where m.text_key = k.text_key
      and not exists (select 1 from picked p where p.text_key = m.text_key and p.target = m.target)
  )
  insert into public.receipt_match_votes (receipt_id, store_id, text_key, target, vote)
  select new.id, v_store, text_key, left(target, 140), 1 from picked
  where text_key <> '' and char_length(text_key) <= 120
  union all
  select new.id, v_store, text_key, target, -1 from corrected
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.learn_receipt_matches() from public, anon, authenticated;

create trigger receipts_learn_matches
  after update of status on public.receipts
  for each row
  when (new.status = 'final' and old.status is distinct from 'final')
  execute function public.learn_receipt_matches();
