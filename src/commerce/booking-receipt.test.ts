import {describe, expect, it} from 'vitest';
import {receiptSummary, type ReceiptSnapshot} from './booking-receipt';

const member = '0x1111111111111111111111111111111111111111';
const snapshot: ReceiptSnapshot = {
  blockNumber: '12',
  total: '20000',
  state: 2,
  positions: [{account: member, share: '10000', paid: '10000', settled: true, disputed: true},
    {account: '0x2222222222222222222222222222222222222222', share: '10000', paid: '0', settled: false, disputed: false}],
};

describe('public booking receipt', () => {
  it('distinguishes a missing settlement event from a zero refund', () => {
    const summary = receiptSummary(snapshot, []);
    expect(summary.held).toBe(0n);
    expect(summary.contributed).toBe(10000n);
    expect(summary.members[0].refund).toBeNull();
    expect(summary.members[1].refund).toBe(0n);
  });

  it('does not attribute pooled wallet claims to individual bookings', () => {
    const summary = receiptSummary(snapshot, [
      {kind: 'Settled', tx_hash: 'settle', block_number: '10', log_index: 0, payload: {member, refund: '10000', payout: '0'}},
      {kind: 'Claimed', tx_hash: 'claim', block_number: '11', log_index: 0, payload: {recipient: member, amount: '10000'}},
    ]);
    expect(summary.members[0].refund).toBe(10000n);
    expect(summary.members[0].transferred).toBeNull();
  });

  it('derives a cancelled refund from finalized state without index coverage', () => {
    const summary = receiptSummary({...snapshot, state: 3}, []);
    expect(summary.members[0].refund).toBe(10000n);
    expect(summary.members[0].transferred).toBeNull();
  });

  it('does not use index entries ahead of the snapshot or allocations that do not match the share', () => {
    const events = [
      {kind: 'Settled', tx_hash: 'ahead', block_number: '13', log_index: 0, payload: {member, refund: '10000', payout: '0'}},
      {kind: 'Settled', tx_hash: 'wrong', block_number: '10', log_index: 0, payload: {member, refund: '10001', payout: '0'}},
    ];
    expect(receiptSummary(snapshot, events).members[0].refund).toBeNull();
  });
});
