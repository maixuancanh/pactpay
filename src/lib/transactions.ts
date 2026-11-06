import type { Address, Hex } from "viem";
export type Pending = {
  hash?: Hex;
  from?: Address;
  nonce?: number;
  to?: Address;
  data?: Hex;
  value?: string;
  startBlock?: string;
  state?: "awaiting-signature" | "submitted" | "unknown";
  label: string;
  chainId: number;
  contract: string;
  quoteId: string;
};
const KEY = "pactpay.pending.v1";
export const readPending = (): Pending | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
};
export function savePending(p: Pending) {
  localStorage.setItem(KEY, JSON.stringify(p));
}
export function clearPending() {
  localStorage.removeItem(KEY);
}

export function requireSuccessfulReceipt(
  receipt: { status: string },
  label: string,
) {
  if (receipt.status !== "success")
    throw Error(
      "Transaction reverted. No successful " +
        label.toLowerCase() +
        " was recorded.",
    );
}

/** Only reconcile an exact saved intent. Never create or resend a transaction. */
export async function findIntentHash(
  client: any,
  intent: Pending,
): Promise<Hex | null> {
  if (intent.hash) return intent.hash;
  if (!intent.from || intent.nonce === undefined || !intent.to || !intent.data)
    return null;
  const end: bigint = await client.getBlockNumber();
  const earliest = end > 80n ? end - 80n : 0n;
  const saved = BigInt(intent.startBlock || "0");
  for (let n = saved > earliest ? saved : earliest; n <= end; n++) {
    const block = await client.getBlock({
      blockNumber: n,
      includeTransactions: true,
    });
    const match = block.transactions.find(
      (tx: any) =>
        typeof tx === "object" &&
        tx.from?.toLowerCase() === intent.from!.toLowerCase() &&
        tx.nonce === intent.nonce &&
        tx.to?.toLowerCase() === intent.to!.toLowerCase() &&
        tx.input === intent.data &&
        BigInt(tx.value || 0) === BigInt(intent.value || "0"),
    );
    if (match) return match.hash;
  }
  return null;
}
export function explicitlyRejected(error: any): boolean {
  for (let e = error, i = 0; e && i < 8; e = e.cause, i++)
    if (e.code === 4001 || e.code === "ACTION_REJECTED") return true;
  return false;
}
