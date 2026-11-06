import type { LedgerRow } from "./merchant-ledger";
export default function MerchantProfile({
  account,
  rows,
}: {
  account: string;
  rows: LedgerRow[];
}) {
  const fresh = rows.filter((row) => row.fresh);
  const totals = fresh.reduce(
    (s, row) => ({
      held: s.held + BigInt(row.held || 0),
      claimable: s.claimable + BigInt(row.merchantCredit || 0),
    }),
    { held: 0n, claimable: 0n },
  );
  return (
    <details>
      <summary>Merchant address and history scope</summary>
      <p>
        Identity key: <code>{account}</code>. Names on agreements are
        self-declared.
      </p>
      <p>
        {rows.length} saved agreements; {fresh.length} fresh finalized state
        reads. Read blocks:{" "}
        {fresh
          .map((row) => row.blockNumber)
          .filter(Boolean)
          .join(", ") || "not checked"}
        .
      </p>
      <p>
        Totals in six-decimal dUSD base units: {totals.held.toString()} held;{" "}
        {totals.claimable.toString()} merchant credit. These are state totals
        for the saved subset, not lifetime payments or service ratings.
      </p>
      <p>
        To inspect more history, use Find orders below, continue its block
        ranges and recover published terms for discovered orders. A wallet may
        have other deployments or older orders not covered here.
      </p>
    </details>
  );
}
