"use client";

import { useActionState, useState } from "react";

import {
  approveMintRequest,
  matchMintRequest,
  type ApproveFormState,
  type MatchFormState,
} from "./actions";

export type MintRequestView = {
  id: string;
  clientName: string;
  amount: string;
  destinationAddress: string;
  status: string;
  createdAt: string;
  txHash: string | null;
  matchType: string | null;
  overriddenBy: string | null;
  overrideReason: string | null;
  matchedTxn: {
    counterpartyName: string;
    amount: string;
    valueDate: string;
    settled: boolean;
  } | null;
};

export type MatchableBankTransaction = {
  id: string;
  valueDate: string;
  counterpartyName: string;
  amount: string;
};

const initialState: MatchFormState = { status: "idle" };
const initialApproveState: ApproveFormState = { status: "idle" };

const COLUMN_COUNT = 6;

const inputClass =
  "rounded border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700";

export function MintRequestRow({
  request,
  matchable,
  matchableError,
}: {
  request: MintRequestView;
  matchable: MatchableBankTransaction[];
  matchableError?: string;
}) {
  const [open, setOpen] = useState(false);
  // Held here, not in ApproveForm: a failure after approval moves the request
  // out of funds_matched, which unmounts the form — the message must survive.
  const [approveState, approveAction, approvePending] = useActionState(
    approveMintRequest,
    initialApproveState,
  );

  const canMatch = request.status === "submitted";
  const canApprove = request.status === "funds_matched";
  const actionLabel = canMatch ? "Match" : canApprove ? "Approve" : null;
  const approveFailedAfterApproval =
    !canApprove && approveState.status === "error";

  return (
    <>
      <tr>
        <td className="px-4 py-2">{request.clientName}</td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">
          {request.amount}
        </td>
        <td className="px-4 py-2 font-mono text-xs">
          {request.destinationAddress}
        </td>
        <td className="px-4 py-2">
          {request.status}
          {request.txHash && (
            <div
              className="max-w-40 truncate font-mono text-xs text-neutral-500"
              title={request.txHash}
            >
              {request.txHash}
            </div>
          )}
        </td>
        <td className="px-4 py-2 whitespace-nowrap">{request.createdAt}</td>
        <td className="px-4 py-2 text-right">
          {actionLabel && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium dark:border-neutral-700"
            >
              {open ? "Cancel" : actionLabel}
            </button>
          )}
        </td>
      </tr>
      {((open && actionLabel) || approveFailedAfterApproval) && (
        <tr>
          <td
            colSpan={COLUMN_COUNT}
            className="bg-neutral-50 px-4 py-4 dark:bg-neutral-900"
          >
            {canMatch &&
              (matchableError ? (
                <p className="text-sm text-red-700 dark:text-red-400">
                  Failed to load bank transactions: {matchableError}
                </p>
              ) : (
                <MatchForm request={request} matchable={matchable} />
              ))}
            {canApprove && (
              <ApproveForm
                request={request}
                state={approveState}
                action={approveAction}
                pending={approvePending}
              />
            )}
            {approveFailedAfterApproval && (
              <p className="text-sm text-red-700 dark:text-red-400">
                {approveState.message}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ApproveForm({
  request,
  state,
  action,
  pending,
}: {
  request: MintRequestView;
  state: ApproveFormState;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const values = state.status === "error" ? state.values : undefined;
  const txn = request.matchedTxn;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="mint_request_id" value={request.id} />

      {/* What the approver is signing off on. */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-neutral-600 dark:text-neutral-400">Mint</dt>
        <dd>
          <span className="font-mono">{request.amount}</span> to{" "}
          <span className="font-mono text-xs">
            {request.destinationAddress}
          </span>
        </dd>

        <dt className="text-neutral-600 dark:text-neutral-400">Funds</dt>
        <dd>
          {txn ? (
            <>
              <span className="font-mono">{txn.amount}</span> from{" "}
              {txn.counterpartyName}, value date {txn.valueDate},{" "}
              {txn.settled ? "settled" : "not settled"}
              {txn.amount !== request.amount && (
                <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                  amount differs from request
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </dd>

        <dt className="text-neutral-600 dark:text-neutral-400">Match</dt>
        <dd>
          {request.matchType === "manual_override"
            ? `Manual, by ${request.overriddenBy}: ${request.overrideReason}`
            : request.matchType === "auto"
              ? "Automatic"
              : "—"}
        </dd>
      </dl>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">
            Approver name
          </span>
          <input
            name="approver"
            type="text"
            required
            defaultValue={values?.approver ?? ""}
            className={`${inputClass} w-56`}
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Approving and minting…" : "Approve and mint"}
        </button>
      </div>

      {state.status === "error" && (
        <p className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}

function MatchForm({
  request,
  matchable,
}: {
  request: MintRequestView;
  matchable: MatchableBankTransaction[];
}) {
  const [state, formAction, pending] = useActionState(
    matchMintRequest,
    initialState,
  );

  // React resets the form after every action; on error, refill it with what
  // was submitted so the operator can correct it rather than redo it.
  const values = state.status === "error" ? state.values : undefined;

  if (matchable.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No settled, unmatched inbound bank transactions.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mint_request_id" value={request.id} />

      <fieldset>
        <legend className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
          Settled, unmatched inbound transactions — request amount{" "}
          <span className="font-mono">{request.amount}</span>
        </legend>
        <div className="space-y-1">
          {matchable.map((txn) => (
            <label
              key={txn.id}
              className="flex items-center gap-3 text-sm"
            >
              <input
                type="radio"
                name="bank_txn_id"
                value={txn.id}
                required
                defaultChecked={values?.bank_txn_id === txn.id}
              />
              <span className="whitespace-nowrap">{txn.valueDate}</span>
              <span>{txn.counterpartyName}</span>
              <span className="font-mono tabular-nums">{txn.amount}</span>
              {txn.amount !== request.amount && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  amount differs
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">
            Operator name
          </span>
          <input
            name="operator"
            type="text"
            required
            defaultValue={values?.operator ?? ""}
            className={`${inputClass} w-56`}
          />
        </label>

        <label className="flex grow flex-col gap-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">
            Reason for manual match
          </span>
          <input
            name="reason"
            type="text"
            required
            defaultValue={values?.reason ?? ""}
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Matching…" : "Confirm match"}
        </button>
      </div>

      {state.status === "error" && (
        <p className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
