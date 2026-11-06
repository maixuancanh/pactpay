import { formatUnits } from "viem";
import { paymentTimeline, settlementSummary } from "./payment-timeline";
import { paymentLabels, type PaymentViewStatus } from "./payment-status";
export default function PaymentTimeline({ snapshot }: { snapshot: any }) {
  const entries = paymentTimeline(snapshot),
    summary = settlementSummary(snapshot);
  const pending =
    snapshot.state === "Captured"
      ? BigInt(snapshot.merchantCredit ?? 0)
      : (snapshot.members ?? []).reduce(
          (sum: bigint, m: any) => sum + BigInt(m.claimable ?? 0),
          0n,
        );
  return (
    <section aria-label="Payment timeline">
      <h3>Payment timeline</h3>
      <p>
        {paymentLabels[summary.status as PaymentViewStatus]} · history{" "}
        {summary.coverage}
      </p>
      <ol>
        {entries.map((e) => (
          <li key={e.key}>
            <strong>{e.label}</strong>
            {e.amount !== undefined && (
              <span> · {formatUnits(BigInt(e.amount), 6)} dUSD</span>
            )}
            {e.recipient && (
              <p>
                Wallet <code>{e.recipient}</code>
              </p>
            )}
            <p>
              Block {e.blockNumber} · transaction{" "}
              <code>{e.transactionHash}</code>
            </p>
          </li>
        ))}
      </ol>
      {pending > 0n && (
        <p>
          At snapshot block {String(snapshot.finalizedBlock)}:{" "}
          {formatUnits(pending, 6)} dUSD remains claimable. This is available
          credit, not a completed transfer.
        </p>
      )}
      {entries.length === 0 && (
        <p>No event has been verified in the scanned range.</p>
      )}
      <p>
        Missing steps are unknown until their events are verified. Timeline
        records money movements and credits, not service delivery.
      </p>
    </section>
  );
}
