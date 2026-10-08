-- Approval and minting of mint requests.
--
--   funds_matched --approve_mint_request--> approved
--   approved      --begin_mint-----------> mint_submitted   (before the chain call)
--   mint_submitted --confirm_mint--------> minted           (+ ledger 'mint' entry)
--
-- begin_mint is the only way into mint_submitted and succeeds at most once per
-- request, so the chain can never be called twice for the same request.
-- Nothing moves a request out of mint_submitted except confirm_mint.

-- ---------------------------------------------------------------------------
-- approve_mint_request: every hard-rule check, then funds_matched -> approved.
-- ---------------------------------------------------------------------------
create or replace function public.approve_mint_request(
  p_mint_request_id uuid,
  p_approver        text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_approver text := trim(coalesce(p_approver, ''));
  v_request  public.mint_requests%rowtype;
  v_txn      public.bank_transactions%rowtype;
  v_client   public.clients%rowtype;
  v_today    date := (now() at time zone 'UTC')::date;
  v_used     numeric;
begin
  if v_approver = '' then
    raise exception 'Approver name is required.';
  end if;

  -- Lock order: request, bank txn, client.
  select * into v_request
    from public.mint_requests
   where id = p_mint_request_id
     for update;

  if not found then
    raise exception 'Mint request % not found.', p_mint_request_id;
  end if;
  if v_request.status <> 'funds_matched' then
    raise exception 'Mint request is %, not funds_matched.', v_request.status;
  end if;

  -- Hard rule 4: approver is neither the submitter nor the overrider.
  -- Case-insensitive, so "alice" and "Alice" count as the same person.
  if lower(v_approver) = lower(trim(v_request.submitted_by)) then
    raise exception 'Approver cannot be the person who submitted the request (%).',
      v_request.submitted_by;
  end if;
  if v_request.overridden_by is not null
     and lower(v_approver) = lower(trim(v_request.overridden_by)) then
    raise exception 'Approver cannot be the person who manually matched the funds (%).',
      v_request.overridden_by;
  end if;

  -- Hard rule 1: a settled inbound bank transaction is matched to it.
  if v_request.matched_bank_txn_id is null then
    raise exception 'Mint request is not matched to a bank transaction.';
  end if;

  select * into v_txn
    from public.bank_transactions
   where id = v_request.matched_bank_txn_id
     for share;

  if not found then
    raise exception 'Matched bank transaction % not found.', v_request.matched_bank_txn_id;
  end if;
  if v_txn.matched_request_id is distinct from v_request.id then
    raise exception 'Matched bank transaction is not linked back to this request.';
  end if;
  if v_txn.direction <> 'inbound' then
    raise exception 'Matched bank transaction is not inbound.';
  end if;
  if not v_txn.settled then
    raise exception 'Matched bank transaction has not settled.';
  end if;

  -- Hard rule 2: destination is an approved whitelisted address of this client.
  if not exists (
    select 1
      from public.whitelisted_addresses w
     where w.client_id = v_request.client_id
       and w.chain = 'sepolia'
       and lower(w.address) = lower(v_request.destination_address)
       and w.status = 'approved'
  ) then
    raise exception 'Destination address % is not an approved whitelisted address for this client.',
      v_request.destination_address;
  end if;

  -- Hard rule 3: within per-transaction and daily limits. The client row is
  -- locked so two approvals for the same client can't both fit under the
  -- daily limit separately and exceed it together.
  select * into v_client
    from public.clients
   where id = v_request.client_id
     for update;

  if v_client.per_txn_limit is null or v_client.daily_limit is null then
    raise exception 'Client % has no per-transaction or daily limit set; cannot approve.',
      v_client.name;
  end if;
  if v_request.amount > v_client.per_txn_limit then
    raise exception 'Amount % exceeds the per-transaction limit %.',
      v_request.amount, v_client.per_txn_limit;
  end if;

  -- Approved today (UTC) and not failed: approved, mint_submitted, minted.
  select coalesce(sum(r.amount), 0) into v_used
    from public.mint_requests r
   where r.client_id = v_request.client_id
     and r.status in ('approved', 'mint_submitted', 'minted')
     and (r.approved_at at time zone 'UTC')::date = v_today;

  if v_used + v_request.amount > v_client.daily_limit then
    raise exception 'Amount % would bring today''s approved total to %, over the daily limit %.',
      v_request.amount, v_used + v_request.amount, v_client.daily_limit;
  end if;

  update public.mint_requests
     set approved_by = v_approver,
         approved_at = now(),
         status      = 'approved',
         updated_at  = now()
   where id = v_request.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- begin_mint: approved -> mint_submitted, immediately BEFORE the chain call.
-- Returns what to mint. Fails if the request is not approved — including when
-- it was already submitted — so the caller must not call the chain then.
-- ---------------------------------------------------------------------------
create or replace function public.begin_mint(
  p_mint_request_id uuid
)
returns table (destination_address text, amount text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
    update public.mint_requests as r
       set status     = 'mint_submitted',
           updated_at = now()
     where r.id = p_mint_request_id
       and r.status = 'approved'
    returning r.destination_address,
              r.amount::text;  -- text: exact decimal, no float rounding in JS

  if not found then
    raise exception 'Mint request is not in approved state (it may already have been submitted). Not minting.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_mint: mint_submitted -> minted, store tx hash, write the ledger
-- 'mint' entry — one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_mint(
  p_mint_request_id uuid,
  p_tx_hash         text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.mint_requests%rowtype;
begin
  select * into v_request
    from public.mint_requests
   where id = p_mint_request_id
     for update;

  if not found then
    raise exception 'Mint request % not found.', p_mint_request_id;
  end if;
  if v_request.status <> 'mint_submitted' then
    raise exception 'Mint request is %, not mint_submitted.', v_request.status;
  end if;
  if v_request.tx_hash is not null and v_request.tx_hash <> p_tx_hash then
    raise exception 'Mint request already has a different tx hash (%).', v_request.tx_hash;
  end if;

  update public.mint_requests
     set status     = 'minted',
         tx_hash    = p_tx_hash,
         updated_at = now()
   where id = v_request.id;

  insert into public.ledger_entries
    (entry_type, asset_type, amount, related_request_id)
  values
    ('mint', 'TOKEN', v_request.amount, v_request.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Only server code (service_role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function public.approve_mint_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.begin_mint(uuid)                 from public, anon, authenticated;
revoke execute on function public.confirm_mint(uuid, text)         from public, anon, authenticated;

grant execute on function public.approve_mint_request(uuid, text) to service_role;
grant execute on function public.begin_mint(uuid)                 to service_role;
grant execute on function public.confirm_mint(uuid, text)         to service_role;
