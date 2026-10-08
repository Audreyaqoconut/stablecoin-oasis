-- record_bank_transaction: record an inbound bank transaction and, if it has
-- settled, its fiat_in ledger entry — atomically.
--
-- The function body runs in a single transaction: if either insert fails,
-- neither row is written. This is what makes "fiat_in is written the moment
-- money settles" hold even for money with no matching request.

create or replace function public.record_bank_transaction(
  p_amount            numeric,
  p_counterparty_name text,
  p_value_date        date,
  p_settled           boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bank_txn_id uuid;
  v_amount      numeric;
begin
  -- The columns are numeric(20,6), which would silently round extra decimal
  -- places. Refuse instead: a recorded amount must be exactly what arrived.
  if p_amount is distinct from round(p_amount, 6) then
    raise exception 'amount % has more than 6 decimal places', p_amount
      using errcode = '22003';
  end if;

  insert into public.bank_transactions
    (direction, amount, counterparty_name, value_date, settled)
  values
    ('inbound', p_amount, p_counterparty_name, p_value_date, p_settled)
  returning id, amount into v_bank_txn_id, v_amount;

  if p_settled then
    -- Unmatched at this point, so no related request: the money shows up as
    -- excess reserve until a mint request claims it.
    insert into public.ledger_entries
      (entry_type, asset_type, amount, related_request_id, related_bank_txn_id)
    values
      ('fiat_in', 'FIAT', v_amount, null, v_bank_txn_id);
  end if;

  return v_bank_txn_id;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC, and Supabase adds
-- anon / authenticated. Only server code (service_role) may call this.
revoke execute on function public.record_bank_transaction(numeric, text, date, boolean)
  from public, anon, authenticated;
grant execute on function public.record_bank_transaction(numeric, text, date, boolean)
  to service_role;
