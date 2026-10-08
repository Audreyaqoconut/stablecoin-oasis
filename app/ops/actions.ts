"use server";

import { refresh } from "next/cache";

import { mintTokens, type Address } from "@/lib/mint-tokens";
import { supabase } from "@/lib/supabase-server";

export type BankTransactionFormValues = {
  amount: string;
  counterparty_name: string;
  value_date: string;
  settled: boolean;
};

export type BankTransactionFormState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string; values: BankTransactionFormValues };

// numeric(20,6): up to 14 integer digits, up to 6 decimal places.
const AMOUNT_PATTERN = /^\d{1,14}(\.\d{1,6})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export async function createInboundBankTransaction(
  _prev: BankTransactionFormState,
  formData: FormData,
): Promise<BankTransactionFormState> {
  const values: BankTransactionFormValues = {
    amount: String(formData.get("amount") ?? "").trim(),
    counterparty_name: String(formData.get("counterparty_name") ?? "").trim(),
    value_date: String(formData.get("value_date") ?? "").trim(),
    settled: formData.get("settled") === "on",
  };

  const fail = (message: string): BankTransactionFormState => ({
    status: "error",
    message,
    values,
  });

  if (!AMOUNT_PATTERN.test(values.amount) || Number(values.amount) <= 0) {
    return fail(
      "Amount must be a positive number with at most 6 decimal places.",
    );
  }
  if (values.counterparty_name.length === 0) {
    return fail("Counterparty name is required.");
  }
  if (!isValidDate(values.value_date)) {
    return fail("Value date must be a valid date.");
  }

  // Inserts the inbound bank transaction and, if settled, its fiat_in ledger
  // entry in one database transaction.
  const { error } = await supabase.rpc("record_bank_transaction", {
    // Sent as a string so Postgres parses the exact decimal, not a float.
    p_amount: values.amount,
    p_counterparty_name: values.counterparty_name,
    p_value_date: values.value_date,
    p_settled: values.settled,
  });

  if (error) {
    return fail(`Insert failed: ${error.message}`);
  }

  refresh();
  return { status: "success" };
}

export type MatchFormValues = {
  bank_txn_id: string;
  operator: string;
  reason: string;
};

export type MatchFormState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string; values: MatchFormValues };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function matchMintRequest(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const mintRequestId = String(formData.get("mint_request_id") ?? "").trim();
  const values: MatchFormValues = {
    bank_txn_id: String(formData.get("bank_txn_id") ?? "").trim(),
    operator: String(formData.get("operator") ?? "").trim(),
    reason: String(formData.get("reason") ?? "").trim(),
  };

  const fail = (message: string): MatchFormState => ({
    status: "error",
    message,
    values,
  });

  if (!UUID_PATTERN.test(mintRequestId)) {
    return fail("Invalid mint request.");
  }
  if (!UUID_PATTERN.test(values.bank_txn_id)) {
    return fail("Select a bank transaction.");
  }
  if (values.operator.length === 0) {
    return fail("Operator name is required.");
  }
  if (values.reason.length === 0) {
    return fail("Reason is required.");
  }

  // Links both sides of the 1:1 match and moves the request to funds_matched
  // in one database transaction. All eligibility checks happen there.
  const { error } = await supabase.rpc("match_mint_request", {
    p_mint_request_id: mintRequestId,
    p_bank_txn_id: values.bank_txn_id,
    p_operator: values.operator,
    p_reason: values.reason,
  });

  if (error) {
    return fail(`Match failed: ${error.message}`);
  }

  refresh();
  return { status: "success" };
}

export type ApproveFormState =
  | { status: "idle" }
  | { status: "success"; txHash: string }
  | { status: "error"; message: string; values: { approver: string } };

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export async function approveMintRequest(
  _prev: ApproveFormState,
  formData: FormData,
): Promise<ApproveFormState> {
  const mintRequestId = String(formData.get("mint_request_id") ?? "").trim();
  const approver = String(formData.get("approver") ?? "").trim();

  const fail = (message: string): ApproveFormState => ({
    status: "error",
    message,
    values: { approver },
  });

  if (!UUID_PATTERN.test(mintRequestId)) {
    return fail("Invalid mint request.");
  }
  if (approver.length === 0) {
    return fail("Approver name is required.");
  }

  // 1. All hard-rule checks, in the database: funds_matched -> approved.
  const approval = await supabase.rpc("approve_mint_request", {
    p_mint_request_id: mintRequestId,
    p_approver: approver,
  });
  if (approval.error) {
    return fail(`Not approved: ${approval.error.message}`);
  }

  // 2. approved -> mint_submitted. Succeeds at most once per request, so only
  //    the caller that gets here may call the chain.
  const begin = await supabase
    .rpc("begin_mint", { p_mint_request_id: mintRequestId })
    .single<{ destination_address: string; amount: string }>();
  if (begin.error) {
    refresh();
    return fail(
      `Approved, but the mint was not started: ${begin.error.message}`,
    );
  }

  const { destination_address, amount } = begin.data;
  if (!ADDRESS_PATTERN.test(destination_address)) {
    refresh();
    return fail(
      `Request is in mint_submitted but its destination address is malformed (${destination_address}). Nothing was minted. Escalate — do not retry.`,
    );
  }

  // 3. The chain call. If it fails, the request stays in mint_submitted:
  //    whether anything happened on-chain is unknown, so a human must check.
  let txHash: string;
  try {
    txHash = await mintTokens(destination_address as Address, amount);
  } catch (e) {
    refresh();
    const reason = e instanceof Error ? e.message : String(e);
    return fail(
      `Mint call failed: ${reason}. Request left in mint_submitted. Escalate — do not retry.`,
    );
  }

  // 4. mint_submitted -> minted, tx hash and ledger 'mint' entry in one
  //    database transaction.
  const confirm = await supabase.rpc("confirm_mint", {
    p_mint_request_id: mintRequestId,
    p_tx_hash: txHash,
  });
  if (confirm.error) {
    refresh();
    return fail(
      `Tokens minted (tx ${txHash}) but recording it failed: ${confirm.error.message}. Request left in mint_submitted. Escalate with this tx hash — do not retry.`,
    );
  }

  refresh();
  return { status: "success", txHash };
}
