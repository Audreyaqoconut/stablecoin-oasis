-- Automatic matching of settled inbound bank transactions to submitted mint
-- requests.
--
-- Rule (CLAUDE.md "Matching"): a request and a bank transaction are a
-- candidate pair when
--   - amounts are exactly equal
--   - the counterparty name matches the client's name (case-insensitive,
--     ignoring leading/trailing whitespace and repeated inner whitespace)
--   - the value date is within 3 days (either side) of the request's
--     creation date (UTC)
--   - the request is submitted and unmatched
--   - the transaction is inbound, settled and unmatched
--
-- A pair is matched only when it is unambiguous from BOTH sides: the request
-- has exactly one candidate transaction, and that transaction has exactly one
-- candidate request. Anything else stays submitted for an operator.
--
-- Runs automatically, in the inserting transaction, when a mint request is
-- inserted as submitted or a settled inbound bank transaction is inserted.

-- ---------------------------------------------------------------------------
-- Candidate pairs. Either argument narrows to one side; both null = all pairs.
-- ---------------------------------------------------------------------------
create or replace function public.auto_match_candidates(
  p_mint_request_id uuid,
  p_bank_txn_id     uuid
)
returns table (mint_request_id uuid, bank_txn_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, t.id
    from public.mint_requests r
    join public.clients c
      on c.id = r.client_id
    join public.bank_transactions t
      on t.amount = r.amount
   where r.status = 'submitted'
     and r.matched_bank_txn_id is null
     and t.direction = 'inbound'
     and t.settled
     and t.matched_request_id is null
     and lower(regexp_replace(trim(t.counterparty_name), '\s+', ' ', 'g'))
       = lower(regexp_replace(trim(c.name),              '\s+', ' ', 'g'))
     and abs(t.value_date - (r.created_at at time zone 'UTC')::date) <= 3
     and (p_mint_request_id is null or r.id = p_mint_request_id)
     and (p_bank_txn_id     is null or t.id = p_bank_txn_id);
$$;

-- ---------------------------------------------------------------------------
-- Try to auto-match one request or one bank transaction (pass exactly one).
-- Returns true if a match was made, false if it was left for an operator.
-- ---------------------------------------------------------------------------
create or replace function public.auto_match(
  p_mint_request_id uuid default null,
  p_bank_txn_id     uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_ids uuid[];
  v_txn_ids     uuid[];
  v_request_id  uuid;
  v_txn_id      uuid;
begin
  if (p_mint_request_id is null) = (p_bank_txn_id is null) then
    raise exception 'pass exactly one of p_mint_request_id, p_bank_txn_id';
  end if;

  select array_agg(c.mint_request_id), array_agg(c.bank_txn_id)
    into v_request_ids, v_txn_ids
    from public.auto_match_candidates(p_mint_request_id, p_bank_txn_id) c;

  if coalesce(cardinality(v_request_ids), 0) <> 1 then
    return false;  -- zero or several candidates: leave for an operator
  end if;

  v_request_id := v_request_ids[1];
  v_txn_id     := v_txn_ids[1];

  -- Lock both rows in the same order as match_mint_request (request, then
  -- bank txn). SKIP LOCKED: if anyone else holds either row (e.g. an operator
  -- matching it right now), don't wait — leave it for manual handling. This
  -- also means auto-matching can never deadlock or block recording money.
  perform 1
     from public.mint_requests
    where id = v_request_id
      and status = 'submitted'
      and matched_bank_txn_id is null
      for update skip locked;
  if not found then
    return false;
  end if;

  perform 1
     from public.bank_transactions
    where id = v_txn_id
      and direction = 'inbound'
      and settled
      and matched_request_id is null
      for update skip locked;
  if not found then
    return false;
  end if;

  -- With both rows locked, confirm the pair still qualifies and is
  -- unambiguous from both sides.
  if not exists (
       select 1 from public.auto_match_candidates(v_request_id, v_txn_id))
     or (select count(*) from public.auto_match_candidates(v_request_id, null)) <> 1
     or (select count(*) from public.auto_match_candidates(null, v_txn_id)) <> 1
  then
    return false;
  end if;

  -- override_reason / overridden_by stay null: the CHECK on mint_requests
  -- requires that for match_type = 'auto'.
  update public.mint_requests
     set matched_bank_txn_id = v_txn_id,
         match_type          = 'auto',
         status              = 'funds_matched',
         updated_at          = now()
   where id = v_request_id;

  update public.bank_transactions
     set matched_request_id = v_request_id
   where id = v_txn_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: try to auto-match on insert, inside the inserting transaction.
-- ---------------------------------------------------------------------------
create or replace function public.auto_match_new_mint_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.auto_match(p_mint_request_id => new.id);
  return null;
end;
$$;

create trigger mint_requests_auto_match
  after insert on public.mint_requests
  for each row
  when (new.status = 'submitted')
  execute function public.auto_match_new_mint_request();

create or replace function public.auto_match_new_bank_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.auto_match(p_bank_txn_id => new.id);
  return null;
end;
$$;

create trigger bank_transactions_auto_match
  after insert on public.bank_transactions
  for each row
  when (new.direction = 'inbound' and new.settled)
  execute function public.auto_match_new_bank_transaction();

-- ---------------------------------------------------------------------------
-- Only server code (service_role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.auto_match_candidates(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.auto_match(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.auto_match_new_mint_request()
  from public, anon, authenticated;
revoke execute on function public.auto_match_new_bank_transaction()
  from public, anon, authenticated;

grant execute on function public.auto_match_candidates(uuid, uuid)     to service_role;
grant execute on function public.auto_match(uuid, uuid)                to service_role;
grant execute on function public.auto_match_new_mint_request()         to service_role;
grant execute on function public.auto_match_new_bank_transaction()     to service_role;
