-- Link ledger entries to the bank transaction that caused them, so every
-- fiat_in / fiat_out can be traced back to the money movement.
--
-- Nullable: TOKEN entries (mint / burn) have no bank transaction.
-- Not unique: a reversing entry points at the same bank transaction.

alter table public.ledger_entries
  add column related_bank_txn_id uuid
    references public.bank_transactions (id) on delete restrict;

create index ledger_entries_related_bank_txn_idx
  on public.ledger_entries (related_bank_txn_id);
