export function isSnapshotFresh(readAt: number, now: number, failed: boolean) {
  return !failed && readAt > 0 && now >= readAt && now - readAt <= 45000;
}
export function agreementNotice(
  state: number,
  now: bigint,
  funding: bigint,
  capture: bigint,
  merchant: boolean,
  credit: bigint,
) {
  if (credit > 0n)
    return "Claim your available credit to transfer tokens to your wallet.";
  if ((state === 1 && now >= funding) || (state === 2 && now >= capture))
    return "The deadline has passed. Process expiry to make contributor refunds claimable.";
  if (state === 2)
    return merchant
      ? "All shares are funded. Capture before the capture deadline, then claim the merchant credit."
      : "All shares are funded. The merchant can capture before the deadline.";
  if (state === 1)
    return "Collection is open. Each member contributes their exact share; contributions can be withdrawn until the group is ready.";
  if (state === 3)
    return "Collection captured. This wallet has no claimable credit. Check the payment evidence to verify whether the merchant payout was claimed.";
  if (state === 4 || state === 5)
    return "Collection closed. This wallet has no claimable credit. Check the refund evidence; zero credit alone does not prove a refund was received.";
  return "Verify this agreement on-chain before making a payment.";
}
