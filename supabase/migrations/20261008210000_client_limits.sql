-- Per-client mint limits (CLAUDE.md hard rule 3).
--
-- Nullable: a client with no limit set cannot have a mint approved — null
-- means "not configured", never "unlimited".

alter table public.clients
  add column per_txn_limit numeric(20,6) check (per_txn_limit > 0),
  add column daily_limit   numeric(20,6) check (daily_limit > 0);
