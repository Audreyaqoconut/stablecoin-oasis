-- Server code talks to Postgres as service_role (lib/supabase-server.ts).
-- Grant it access to the app tables. anon / authenticated get nothing:
-- these tables are not readable from the browser.
--
-- No DELETE anywhere: requests and bank transactions are audit records.
-- No UPDATE on ledger_entries: the ledger is append-only.

grant usage on schema public to service_role;

grant select, insert, update on
  public.clients,
  public.whitelisted_addresses,
  public.bank_transactions,
  public.mint_requests,
  public.redemption_requests,
  public.reconciliation_breaks
to service_role;

grant select, insert on public.ledger_entries to service_role;
