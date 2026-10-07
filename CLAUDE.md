# Stablecoin Ops — Project Context

A demo stablecoin issuance / redemption / operations platform.
Testnet only, with a simulated bank leg. Not a production system.

Stack: Next.js (App Router, TypeScript) · Tailwind · Supabase (Postgres) · viem · Sepolia

---

## The hard rule

**No mint may execute unless all of the following hold:**

1. A settled inbound bank transaction has been matched to the request
2. The destination address is whitelisted to that client
3. The amount is within the client's per-transaction and daily limits
4. A named human has approved it, and that human is not the one who
   submitted or manually overrode the match

On-chain mints are irreversible. Every check happens in the database
layer, before any contract call.

---

## Ledger principles

- The ledger is **append-only**. Entries are never edited or deleted.
  A mistake is corrected by writing a reversing entry.
- FIAT and TOKEN are tracked as separate asset types in the same table.
  They do not move in lockstep — the gap between them is meaningful,
  not an error.
- `fiat_in` is written **the moment money settles**, not when the mint
  completes. `mint` is written when the on-chain tx confirms.
  The window between them is a legitimate over-collateralised state.
- Same on the way out: `burn` on confirmation, `fiat_out` when the
  wire is issued.
- Money that arrives with no matching request still hits the ledger.
  It shows up as excess reserve — unclaimed funds should be visible,
  not invisible.

---

## Tables

### clients
`id` · `name` · `kyb_status` (pending / approved / rejected) · `created_at`

### whitelisted_addresses
`id` · `client_id` · `address` · `chain` · `status` · `approved_at`

### mint_requests
`id` · `client_id` · `amount` · `destination_address` · `status`
`submitted_by`
`matched_bank_txn_id` (nullable)
`match_type` (auto / manual_override, nullable)
`override_reason` (nullable)
`overridden_by` (nullable)
`approved_by` (nullable) · `approved_at` (nullable)
`tx_hash` (nullable)
`created_at` · `updated_at`

### redemption_requests
`id` · `client_id` · `amount` · `source_address` · `status`
`burn_tx_hash` (nullable)
`payout_reference` (nullable)
`created_at` · `updated_at`

### bank_transactions
`id` · `direction` (inbound / outbound) · `amount` · `counterparty_name`
`value_date` · `settled` (boolean)
`matched_request_id` (nullable)

### ledger_entries
`id` · `entry_type` (mint / burn / fiat_in / fiat_out)
`asset_type` (TOKEN / FIAT) · `amount`
`related_request_id` (nullable — not every entry comes from a request)
`created_at`

### reconciliation_breaks
`id` · `snapshot_time`
`onchain_supply` · `ledger_balance` · `reserve_balance`
`difference` · `status` (open / investigating / cleared) · `notes`

---

## State machines

### Mint request

```
submitted
  → funds_matched      settled inbound payment matched
                       (auto by rule, or manual_override with reason + actor)
  → approved           human approval; whitelist + limits verified
                       approved_by != submitted_by != overridden_by
  → mint_submitted     contract call sent, tx_hash recorded, not yet confirmed
  → minted             tx confirmed; ledger entry written
```

Failure branches:
```
submitted      → rejected       KYB fail / address not whitelisted / limit breach
mint_submitted → mint_failed    tx reverted — do NOT auto-retry, escalate to human
```

`mint_submitted` exists so a sent-but-unconfirmed transaction can never be
re-sent. Nothing moves out of this state automatically except on confirmation.

### Redemption request

```
tokens_received      detected at treasury address
  → screened         sanctions + blacklist check passed
  → burned           burn tx confirmed; ledger entry written
  → payout_sent      fiat wire issued; ledger entry written
```

Failure branches:
```
tokens_received → frozen          screening hit — escalate, do not burn
burned          → payout_failed   client holds neither tokens nor fiat — escalate immediately
```

---

## Matching

One bank transaction matches exactly one mint request. Strict 1:1.

This deliberately excludes split payments, partial payments, and
prefunded balances. Those cases are not unsupported — they fall out
of the automated path and are handled by a human via manual override,
which is always recorded with a reason and an actor.

Auto-match rule: amount equal, counterparty matches the client,
value date within an acceptable window, transaction settled.

---

## Build order

1. Schema + seed data
2. Mint flow, manual throughout, with mint stubbed (no chain)
3. Replace the stub with a real Sepolia contract call
4. Redemption flow + treasury address polling
5. Reconciliation logic behind a manual button
6. Dashboard, then move reconciliation onto a schedule

Work in vertical slices — one complete path at a time, clickable before
moving on. Not layer by layer.
