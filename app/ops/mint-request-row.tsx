"use client";

import { useActionState, useState } from "react";

import { matchMintRequest, type MatchFormState } from "./actions";

export type MintRequestView = {
  id: string;
  clientName: string;
  amount: string;
  destinationAddress: string;
  status: string;
  createdAt: string;
};

export type MatchableBankTransaction = {
  id: string;
  valueDate: string;
  counterpartyName: string;
  amount: string;
};

const initialState: MatchFormState = { status: "idle" };

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
  const canMatch = request.status === "submitted";

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
        <td className="px-4 py-2">{request.status}</td>
        <td className="px-4 py-2 whitespace-nowrap">{request.createdAt}</td>
        <td className="px-4 py-2 text-right">
          {canMatch && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium dark:border-neutral-700"
            >
              {open ? "Cancel" : "Match"}
            </button>
          )}
        </td>
      </tr>
      {canMatch && open && (
        <tr>
          <td
            colSpan={COLUMN_COUNT}
            className="bg-neutral-50 px-4 py-4 dark:bg-neutral-900"
          >
            {matchableError ? (
              <p className="text-sm text-red-700 dark:text-red-400">
                Failed to load bank transactions: {matchableError}
              </p>
            ) : (
              <MatchForm request={request} matchable={matchable} />
            )}
          </td>
        </tr>
      )}
    </>
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
