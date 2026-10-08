import type { Metadata } from "next";
import { connection } from "next/server";

import { supabase } from "@/lib/supabase-server";

import { BankTransactionForm } from "./bank-transaction-form";
import {
  MintRequestRow,
  type MatchableBankTransaction,
} from "./mint-request-row";

export const metadata: Metadata = {
  title: "Ops",
};

type MintRequestRecord = {
  id: string;
  amount: number | string;
  destination_address: string;
  status: string;
  created_at: string;
  tx_hash: string | null;
  match_type: string | null;
  overridden_by: string | null;
  override_reason: string | null;
  client: { name: string } | null;
  matched_txn: {
    amount: number | string;
    counterparty_name: string;
    value_date: string;
    settled: boolean;
  } | null;
};

type BankTransactionRow = {
  id: string;
  direction: string;
  amount: number | string;
  counterparty_name: string;
  value_date: string;
  settled: boolean;
  matched_request_id: string | null;
};

function formatTimestamp(iso: string) {
  // Always UTC, so every operator sees the same time.
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

const tableWrapClass =
  "overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800";
const theadClass =
  "bg-neutral-50 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400";
const tbodyClass = "divide-y divide-neutral-200 dark:divide-neutral-800";
const errorClass =
  "rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200";

export default async function OpsPage() {
  // Render per request: this is an operations view and must never be a
  // build-time snapshot.
  await connection();

  const [mintRequests, bankTransactions, matchableTransactions] =
    await Promise.all([
    supabase
      .from("mint_requests")
      .select(
        // Two FKs link these tables (one each way); the hint picks
        // mint_requests.matched_bank_txn_id.
        "id, amount, destination_address, status, created_at, tx_hash, " +
          "match_type, overridden_by, override_reason, client:clients(name), " +
          "matched_txn:bank_transactions!mint_requests_matched_bank_txn_id_fkey" +
          "(amount, counterparty_name, value_date, settled)",
      )
      .order("created_at", { ascending: false })
      .overrideTypes<MintRequestRecord[], { merge: false }>(),
    supabase
      .from("bank_transactions")
      .select(
        "id, direction, amount, counterparty_name, value_date, settled, matched_request_id",
      )
      .order("value_date", { ascending: false })
      .overrideTypes<BankTransactionRow[], { merge: false }>(),
    // Candidates for a manual match. The database function re-checks all of
    // this under a row lock; this list is only what the operator picks from.
    supabase
      .from("bank_transactions")
      .select("id, amount, counterparty_name, value_date")
      .eq("direction", "inbound")
      .eq("settled", true)
      .is("matched_request_id", null)
      .order("value_date", { ascending: false })
      .overrideTypes<
        Pick<
          BankTransactionRow,
          "id" | "amount" | "counterparty_name" | "value_date"
        >[],
        { merge: false }
      >(),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const matchable: MatchableBankTransaction[] = (
    matchableTransactions.data ?? []
  ).map((txn) => ({
    id: txn.id,
    valueDate: txn.value_date,
    counterpartyName: txn.counterparty_name,
    amount: String(txn.amount),
  }));

  return (
    <main className="mx-auto w-full max-w-6xl space-y-12 px-4 py-8">
      <section>
        <h2 className="mb-4 text-2xl font-semibold">Mint requests</h2>

        {mintRequests.error ? (
          <p className={errorClass}>
            Failed to load mint requests: {mintRequests.error.message}
          </p>
        ) : !mintRequests.data || mintRequests.data.length === 0 ? (
          <p className="text-sm text-neutral-500">No mint requests.</p>
        ) : (
          <div className={tableWrapClass}>
            <table className="w-full text-left text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Destination address</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Created at</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {mintRequests.data.map((row) => (
                  <MintRequestRow
                    key={row.id}
                    request={{
                      id: row.id,
                      clientName: row.client?.name ?? "—",
                      amount: String(row.amount),
                      destinationAddress: row.destination_address,
                      status: row.status,
                      createdAt: formatTimestamp(row.created_at),
                      txHash: row.tx_hash,
                      matchType: row.match_type,
                      overriddenBy: row.overridden_by,
                      overrideReason: row.override_reason,
                      matchedTxn: row.matched_txn && {
                        counterpartyName: row.matched_txn.counterparty_name,
                        amount: String(row.matched_txn.amount),
                        valueDate: row.matched_txn.value_date,
                        settled: row.matched_txn.settled,
                      },
                    }}
                    matchable={matchable}
                    matchableError={matchableTransactions.error?.message}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold">Bank transactions</h2>

        <BankTransactionForm today={today} />

        {bankTransactions.error ? (
          <p className={errorClass}>
            Failed to load bank transactions: {bankTransactions.error.message}
          </p>
        ) : !bankTransactions.data || bankTransactions.data.length === 0 ? (
          <p className="text-sm text-neutral-500">No bank transactions.</p>
        ) : (
          <div className={tableWrapClass}>
            <table className="w-full text-left text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="px-4 py-2 font-medium">Value date</th>
                  <th className="px-4 py-2 font-medium">Direction</th>
                  <th className="px-4 py-2 font-medium">Counterparty</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Settled</th>
                  <th className="px-4 py-2 font-medium">Matched request</th>
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {bankTransactions.data.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {row.value_date}
                    </td>
                    <td className="px-4 py-2">{row.direction}</td>
                    <td className="px-4 py-2">{row.counterparty_name}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {String(row.amount)}
                    </td>
                    <td className="px-4 py-2">{row.settled ? "Yes" : "No"}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {row.matched_request_id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
