export type ReceiptSnapshot = {
  blockNumber: string;
  total: string;
  state: number;
  merchantCredit?: string;
  positions: {account: string; share: string; paid: string; settled: boolean; disputed: boolean; contractCredit?: string}[];
};

export type ReceiptEvent = {
  kind: string;
  tx_hash: string;
  block_number: string;
  log_index: number;
  payload: Record<string, unknown>;
};

function amount(value: unknown) {
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}

export function receiptSummary(snapshot: ReceiptSnapshot, events: ReceiptEvent[]) {
  const members = snapshot.positions.map(position => {
    const paid = BigInt(position.paid);
    const allocations = events.filter(event =>
      event.kind === 'Settled' &&
      String(event.payload.member).toLowerCase() === position.account.toLowerCase() &&
      BigInt(event.block_number) <= BigInt(snapshot.blockNumber),
    );
    const refund = amount(allocations[0]?.payload.refund);
    const payout = amount(allocations[0]?.payload.payout);
    const allocationKnown = allocations.length === 1 && refund !== null && payout !== null && refund + payout === paid;
    // In V2 a settled funding/cancelled position can only be a full refund.
    // A captured position with no complaint can only be paid to the merchant.
    const provenRefund = snapshot.state === 1 || snapshot.state === 3 ? paid :
      snapshot.state === 2 && !position.disputed ? 0n : null;
    const allocatedRefund = !position.settled ? 0n : allocationKnown ? refund : provenRefund;
    const allocatedPayout = !position.settled ? 0n : allocationKnown ? payout :
      provenRefund === null ? null : paid - provenRefund;
    return {
      ...position,
      paid,
      held: position.settled ? 0n : paid,
      refund: allocatedRefund,
      payout: allocatedPayout,
      // V2 Claim events carry the recipient and pooled amount, with no booking ID.
      transferred: null,
    };
  });
  return {
    members,
    contributed: members.reduce((total, member) => total + member.paid, 0n),
    held: members.reduce((total, member) => total + member.held, 0n),
  };
}

export const receiptEventLabels: Record<string, string> = {
  Created: 'Booking opened',
  Funded: 'Share contributed',
  Contributed: 'Share contributed',
  Captured: 'Merchant captured the booking',
  Disputed: 'Member opened a complaint',
  Settled: 'Share allocated to refund or payout',
  Claimed: 'Wallet received contract credit',
  Cancelled: 'Booking cancelled',
  Expired: 'Booking expired',
  Withdrawn: 'Contribution withdrawn',
};
