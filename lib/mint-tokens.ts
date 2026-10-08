import "server-only";

import { randomBytes } from "node:crypto";

export type Address = `0x${string}`;
export type TxHash = `0x${string}`;

/**
 * Mint `amount` tokens to `to` on-chain.
 *
 * Contract for implementations:
 * - Resolves with the transaction hash once the mint is confirmed on-chain.
 * - Rejects if the transaction could not be sent or reverted.
 * - Is called at most once per mint request; the caller guarantees this by
 *   moving the request to mint_submitted first. Implementations must not
 *   retry a send on their own.
 *
 * @param to     Destination address. Already verified by the database as an
 *               approved whitelisted address of the client.
 * @param amount Decimal string in token units, e.g. "1500.25". A string so no
 *               precision is lost; a real implementation converts it with
 *               parseUnits(amount, decimals).
 *
 * STUB: nothing is sent. Logs the call and returns a random fake hash.
 * Replace the body with a real Sepolia contract call; keep the signature.
 */
export async function mintTokens(to: Address, amount: string): Promise<TxHash> {
  const txHash: TxHash = `0x${randomBytes(32).toString("hex")}`;
  console.log(
    `[mintTokens STUB] to=${to} amount=${amount} txHash=${txHash} — not sent on-chain`,
  );
  return txHash;
}
