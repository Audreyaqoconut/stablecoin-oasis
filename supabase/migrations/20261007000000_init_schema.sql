-- Stablecoin Ops: initial schema
-- Source of truth: CLAUDE.md, "Tables" section.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (length(trim(name)) > 0),
  kyb_status  text        not null default 'pending'
              check (kyb_status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- whitelisted_addresses
-- ---------------------------------------------------------------------------
create table public.whitelisted_addresses (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references public.clients (id) on delete restrict,
  address      text        not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  chain        text        not null default 'sepolia'
               check (chain in ('sepolia')),
  status       text        not null default 'pending'
               check (status in ('pending', 'approved', 'revoked')),
  approved_at  timestamptz,
  constraint whitelisted_addresses_approved_at_chk
    check (status <> 'approved' or approved_at is not null)
);

-- One address belongs to at most one client per chain (case-insensitive,
-- since EIP-55 checksummed and lowercase forms are the same address).
create unique index whitelisted_addresses_chain_address_uq
  on public.whitelisted_addresses (chain, lower(address));

-- ---------------------------------------------------------------------------
-- bank_transactions
-- (FK to mint_requests is added after that table exists — circular reference)
-- ---------------------------------------------------------------------------
create table public.bank_transactions (
  id                  uuid          primary key default gen_random_uuid(),
  direction           text          not null check (direction in ('inbound', 'outbound')),
  amount              numeric(20,6) not null check (amount > 0),
  counterparty_name   text          not null check (length(trim(counterparty_name)) > 0),
  value_date          date          not null,
  settled             boolean       not null default false,
  matched_request_id  uuid,
  -- Strict 1:1 matching: a bank txn matches at most one request.
  constraint bank_transactions_matched_request_uq unique (matched_request_id),
  -- Only inbound money is matched to (mint) requests.
  constraint bank_transactions_match_inbound_only_chk
    check (matched_request_id is null or direction = 'inbound')
);

-- ---------------------------------------------------------------------------
-- mint_requests
-- ---------------------------------------------------------------------------
create table public.mint_requests (
  id                   uuid          primary key default gen_random_uuid(),
  client_id            uuid          not null references public.clients (id) on delete restrict,
  amount               numeric(20,6) not null check (amount > 0),
  destination_address  text          not null check (destination_address ~ '^0x[0-9a-fA-F]{40}$'),
  status               text          not null default 'submitted'
                       check (status in (
                         'submitted', 'funds_matched', 'approved',
                         'mint_submitted', 'minted',
                         'rejected', 'mint_failed'
                       )),
  submitted_by         text          not null check (length(trim(submitted_by)) > 0),
  matched_bank_txn_id  uuid          references public.bank_transactions (id) on delete restrict,
  match_type           text          check (match_type in ('auto', 'manual_override')),
  override_reason      text,
  overridden_by        text,
  approved_by          text,
  approved_at          timestamptz,
  tx_hash              text          check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),

  -- Strict 1:1 matching: a bank txn backs at most one mint request.
  constraint mint_requests_matched_bank_txn_uq unique (matched_bank_txn_id),
  -- A tx hash can only ever be recorded against one request.
  constraint mint_requests_tx_hash_uq unique (tx_hash),

  -- A match and its type are recorded together.
  constraint mint_requests_match_pair_chk
    check ((matched_bank_txn_id is null) = (match_type is null)),
  -- A manual override always carries a reason and an actor; an auto match never does.
  constraint mint_requests_override_fields_chk
    check (
      -- coalesce: a NULL here would make the CHECK evaluate to NULL, which passes.
      (match_type = 'manual_override'
         and length(trim(coalesce(override_reason, ''))) > 0
         and length(trim(coalesce(overridden_by, '')))  > 0)
      or
      (match_type is distinct from 'manual_override'
         and override_reason is null
         and overridden_by   is null)
    ),
  -- Approver and approval time are recorded together.
  constraint mint_requests_approval_pair_chk
    check ((approved_by is null) = (approved_at is null)),
  -- Hard rule 4: approver is neither the submitter nor the overrider.
  constraint mint_requests_four_eyes_chk
    check (
      approved_by is null
      or (approved_by <> submitted_by
          and approved_by is distinct from overridden_by)
    )
);

alter table public.bank_transactions
  add constraint bank_transactions_matched_request_fk
  foreign key (matched_request_id) references public.mint_requests (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- redemption_requests
-- ---------------------------------------------------------------------------
create table public.redemption_requests (
  id                uuid          primary key default gen_random_uuid(),
  client_id         uuid          not null references public.clients (id) on delete restrict,
  amount            numeric(20,6) not null check (amount > 0),
  source_address    text          not null check (source_address ~ '^0x[0-9a-fA-F]{40}$'),
  status            text          not null default 'tokens_received'
                    check (status in (
                      'tokens_received', 'screened', 'burned', 'payout_sent',
                      'frozen', 'payout_failed'
                    )),
  burn_tx_hash      text          check (burn_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  payout_reference  text,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  constraint redemption_requests_burn_tx_hash_uq unique (burn_tx_hash)
);

-- ---------------------------------------------------------------------------
-- ledger_entries (append-only)
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id                  uuid          primary key default gen_random_uuid(),
  entry_type          text          not null
                      check (entry_type in ('mint', 'burn', 'fiat_in', 'fiat_out')),
  asset_type          text          not null check (asset_type in ('TOKEN', 'FIAT')),
  -- Signed so a mistake can be corrected by a reversing entry.
  amount              numeric(20,6) not null check (amount <> 0),
  -- Polymorphic (mint OR redemption request), so no FK. Nullable: unmatched
  -- inbound money is still booked.
  related_request_id  uuid,
  created_at          timestamptz   not null default now(),
  -- mint/burn move TOKEN; fiat_in/fiat_out move FIAT.
  constraint ledger_entries_type_asset_chk
    check (
      (entry_type in ('mint', 'burn')         and asset_type = 'TOKEN')
      or (entry_type in ('fiat_in', 'fiat_out') and asset_type = 'FIAT')
    )
);

-- ---------------------------------------------------------------------------
-- reconciliation_breaks
-- ---------------------------------------------------------------------------
create table public.reconciliation_breaks (
  id               uuid          primary key default gen_random_uuid(),
  snapshot_time    timestamptz   not null default now(),
  onchain_supply   numeric(20,6) not null,
  ledger_balance   numeric(20,6) not null,
  reserve_balance  numeric(20,6) not null,
  difference       numeric(20,6) not null,
  status           text          not null default 'open'
                   check (status in ('open', 'investigating', 'cleared')),
  notes            text
);

-- ---------------------------------------------------------------------------
-- Indexes on FK / lookup columns
-- ---------------------------------------------------------------------------
create index whitelisted_addresses_client_id_idx on public.whitelisted_addresses (client_id);
create index mint_requests_client_id_idx         on public.mint_requests (client_id);
create index mint_requests_status_idx            on public.mint_requests (status);
create index redemption_requests_client_id_idx   on public.redemption_requests (client_id);
create index redemption_requests_status_idx      on public.redemption_requests (status);
create index ledger_entries_related_request_idx  on public.ledger_entries (related_request_id);
create index reconciliation_breaks_status_idx    on public.reconciliation_breaks (status);
