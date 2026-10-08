import type { Metadata } from "next";
import { connection } from "next/server";

import { supabase } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Ops · Mint requests",
};

type MintRequestRow = {
  id: string;
  amount: number | string;
  destination_address: string;
  status: string;
  created_at: string;
  client: { name: string } | null;
};

function formatTimestamp(iso: string) {
  // Always UTC, so every operator sees the same time.
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function OpsPage() {
  // Render per request: this is an operations view and must never be a
  // build-time snapshot.
  await connection();

  const { data, error } = await supabase
    .from("mint_requests")
    .select(
      "id, amount, destination_address, status, created_at, client:clients(name)",
    )
    .order("created_at", { ascending: false })
    .overrideTypes<MintRequestRow[], { merge: false }>();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Mint requests</h1>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Failed to load mint requests: {error.message}
        </p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-neutral-500">No mint requests.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Destination address</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {data.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">{row.client?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {String(row.amount)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {row.destination_address}
                  </td>
                  <td className="px-4 py-2">{row.status}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatTimestamp(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
