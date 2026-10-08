"use client";

import { useActionState } from "react";

import {
  createInboundBankTransaction,
  type BankTransactionFormState,
} from "./actions";

const initialState: BankTransactionFormState = { status: "idle" };

const inputClass =
  "rounded border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700";

export function BankTransactionForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(
    createInboundBankTransaction,
    initialState,
  );

  // React resets the form after every action; on error, refill it with what
  // was submitted so the operator can correct it rather than retype it.
  const values = state.status === "error" ? state.values : undefined;

  return (
    <form
      action={formAction}
      className="mb-6 flex flex-wrap items-end gap-4 rounded border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600 dark:text-neutral-400">Amount</span>
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          required
          pattern="\d{1,14}(\.\d{1,6})?"
          placeholder="0.00"
          defaultValue={values?.amount ?? ""}
          className={`${inputClass} w-40 font-mono`}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600 dark:text-neutral-400">
          Counterparty name
        </span>
        <input
          name="counterparty_name"
          type="text"
          required
          defaultValue={values?.counterparty_name ?? ""}
          className={`${inputClass} w-64`}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600 dark:text-neutral-400">
          Value date
        </span>
        <input
          name="value_date"
          type="date"
          required
          defaultValue={values?.value_date ?? today}
          className={inputClass}
        />
      </label>

      <label className="flex items-center gap-2 py-1.5 text-sm">
        <input
          name="settled"
          type="checkbox"
          defaultChecked={values?.settled ?? false}
        />
        Settled
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? "Adding…" : "Add inbound transaction"}
      </button>

      {state.status === "error" && (
        <p className="w-full text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
      {state.status === "success" && !pending && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">
          Transaction added.
        </p>
      )}
    </form>
  );
}
