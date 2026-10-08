-- match_mint_request: an operator manually matches a settled inbound bank
-- transaction to a submitted mint request.
--
-- Both sides of the 1:1 link are written in one transaction:
--   mint_requests.matched_bank_txn_id  and  bank_transactions.matched_request_id
--
-- A human choosing the bank transaction is a manual override, so the operator
-- is recorded in overridden_by (which the four-eyes CHECK compares against
-- approved_by) and a reason is required.

create or replace function public.match_mint_request(
  p_mint_request_id uuid,
  p_bank_txn_id     uuid,
  p_operator        text,
  p_reason          text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.mint_requests%rowtype;
  v_txn     public.bank_transactions%rowtype;
begin
  if length(trim(coalesce(p_operator, ''))) = 0 then
    raise exception 'operator name is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'override reason is required';
  end if;

  -- Lock both rows (always request first, then bank txn) so two operators
  -- matching at the same time can't both succeed.
  select * into v_request
    from public.mint_requests
    where id = p_mint_request_id
    for update;

  if not found then
    raise exception 'mint request % not found', p_mint_request_id;
  end if;
  if v_request.status <> 'submitted' then
    raise exception 'mint request % is %, not submitted',
      p_mint_request_id, v_request.status;
  end if;
  if v_request.matched_bank_txn_id is not null then
    raise exception 'mint request % is already matched', p_mint_request_id;
  end if;

  select * into v_txn
    from public.bank_transactions
    where id = p_bank_txn_id
    for update;

  if not found then
    raise exception 'bank transaction % not found', p_bank_txn_id;
  end if;
  if v_txn.direction <> 'inbound' then
    raise exception 'bank transaction % is not inbound', p_bank_txn_id;
  end if;
  if not v_txn.settled then
    raise exception 'bank transaction % has not settled', p_bank_txn_id;
  end if;
  if v_txn.matched_request_id is not null then
    raise exception 'bank transaction % is already matched', p_bank_txn_id;
  end if;

  update public.mint_requests
    set matched_bank_txn_id = p_bank_txn_id,
        match_type          = 'manual_override',
        override_reason     = trim(p_reason),
        overridden_by       = trim(p_operator),
        status              = 'funds_matched',
        updated_at          = now()
    where id = p_mint_request_id;

  update public.bank_transactions
    set matched_request_id = p_mint_request_id
    where id = p_bank_txn_id;
end;
$$;

-- Only server code (service_role) may call this.
revoke execute on function public.match_mint_request(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.match_mint_request(uuid, uuid, text, text)
  to service_role;
