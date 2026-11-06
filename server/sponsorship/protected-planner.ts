import {readFileSync} from 'node:fs';
import {encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex, type Abi, type Address, type Hex} from 'viem';
import {requireThat} from '../lib.js';
import type {Row} from '../db/database.js';
import type {RelayAction} from './compact-planner.js';
import type {RelayCall} from './compact-codec.js';

export const protectedRelayAbi = JSON.parse(readFileSync(new URL('../payments/protected-abi.json', import.meta.url), 'utf8')) as Abi;
const tokenAbi = parseAbi(['function approve(address,uint256) returns(bool)']);
export type ProtectedRelayBooking = {
  merchant: Address;
  state: number;
  fundingDeadline: bigint;
  captureDeadline: bigint;
  window: bigint;
  resolutionPeriod: bigint;
  capturedAt: bigint;
  total: bigint;
  funded: bigint;
  termsHash: Hex;
  members: Address[];
};
export type ProtectedRelaySnapshot = {
  timestamp: bigint;
  merchantNonce: bigint;
  token: Address;
  credit: bigint;
  booking?: ProtectedRelayBooking;
  positions: {account: Address; share: bigint; paid: bigint; disputed: boolean; settled: boolean}[];
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function buildProtectedRelayPlan(input: {
  room: Row;
  account: Address;
  action: RelayAction;
  escrow: Address;
  token: Address;
  snapshot: ProtectedRelaySnapshot;
  now: number;
  expiresAt: number;
}) {
  const {room, account, escrow, snapshot, action} = input;
  requireThat(room.settlementVersion === 'protected-v2', 'relay_version_mismatch', undefined, 409);
  requireThat(Buffer.byteLength(room.canonicalTerms??'', 'utf8')<=16000,'relay_terms_too_large');
  requireThat(room.canonicalTerms && room.termsHash === keccak256(toHex(room.canonicalTerms)), 'relay_terms_changed');
  requireThat(Math.abs(input.now - Number(snapshot.timestamp) * 1000) <= 180000, 'relay_snapshot_stale');
  requireThat(same(snapshot.token, input.token), 'relay_token_mismatch');
  const members = room.members as Row[];
  const addresses = members.map(member => member.accountAddress as Address);
  const shares = members.map(member => BigInt(member.share));
  requireThat(members.length > 0 && members.length <= 5 &&
    members.every(member => member.acceptedRevision === room.revision) &&
    new Set(addresses.map(address => address.toLowerCase())).size === members.length &&
    shares.every(share => share > 0n) && shares.reduce((a, b) => a + b, 0n) === BigInt(room.total),
  'relay_roster_consent_required');
  const merchant = same(account, room.merchantAccountAddress);
  const call = (name: string, args: unknown[]): RelayCall => ({
    target: escrow,
    data: encodeFunctionData({abi: protectedRelayAbi, functionName: name, args}),
  });
  let quoteId: Hex;
  let calls: RelayCall[];
  let amount = 0n;
  let reviewLabel: string;
  let recipient = escrow;
  if (action === 'publish') {
    requireThat(merchant && room.status === 'locked' && !room.protectedBooking, 'relay_publish_unavailable');
    requireThat(addresses.every(address => !same(address, account)), 'relay_merchant_cannot_contribute');
    const funding = BigInt(Math.floor(Date.parse(room.fundingDeadline) / 1000));
    const capture = BigInt(Math.floor(Date.parse(room.serviceAt) / 1000));
    requireThat(funding > snapshot.timestamp && capture > funding, 'relay_funding_closed');
    quoteId = keccak256(encodeAbiParameters(
      [{type: 'uint256'}, {type: 'address'}, {type: 'address'}, {type: 'uint256'}],
      [420420777n, escrow, account, snapshot.merchantNonce],
    ));
    calls = [call('create', [addresses, shares, funding, capture,
      BigInt(room.complaintSeconds), BigInt(room.resolutionSeconds), room.termsHash])];
    amount = BigInt(room.total);
    reviewLabel = 'Open protected payments';
  } else {
    const binding = room.protectedBooking;
    const booking = snapshot.booking;
    requireThat(binding && binding.chainId === 420420777 && same(binding.escrow, escrow) && booking,
      'relay_finalized_quote_required');
    quoteId = binding.quoteId;
    const b = booking!;
    requireThat(same(b.merchant, room.merchantAccountAddress) && b.termsHash === room.termsHash &&
      b.total === BigInt(room.total) && b.fundingDeadline === BigInt(Math.floor(Date.parse(room.fundingDeadline) / 1000)) &&
      b.captureDeadline === BigInt(Math.floor(Date.parse(room.serviceAt) / 1000)) &&
      b.window === BigInt(room.complaintSeconds) && b.resolutionPeriod === BigInt(room.resolutionSeconds) &&
      b.members.length === members.length && b.members.every((address, index) => same(address, addresses[index])) &&
      snapshot.positions.length === members.length &&
      snapshot.positions.every((position, index) => same(position.account, addresses[index]) && position.share === shares[index]),
    'relay_snapshot_mismatch', undefined, 409);
    const position = snapshot.positions.find(position => same(position.account, account));
    if (action === 'payment') {
      requireThat(position && b.state === 1 && position.paid === 0n && snapshot.timestamp < b.fundingDeadline,
        'relay_payment_unavailable');
      amount = position!.share;
      calls = [{target: input.token, data: encodeFunctionData({
        abi: tokenAbi, functionName: 'approve', args: [escrow, amount],
      })}, call('contribute', [quoteId])];
      reviewLabel = 'Pay my exact share';
    } else if (action === 'cancel') {
      requireThat(merchant && b.state === 1, 'relay_cancel_unavailable');
      calls = [call('cancel', [quoteId])];
      reviewLabel = 'Cancel booking and open refunds';
    } else if (action === 'refund') {
      requireThat(position && position.paid > 0n, 'relay_member_required');
      const refundDue = b.state === 3 || (b.state === 1 &&
        (snapshot.timestamp >= b.captureDeadline || (b.funded < b.total && snapshot.timestamp >= b.fundingDeadline))) ||
        (b.state === 2 && position!.disputed && snapshot.timestamp >= b.capturedAt + b.window + b.resolutionPeriod);
      requireThat(position!.settled ? snapshot.credit > 0n : refundDue, 'relay_refund_unavailable');
      calls = position!.settled ? [call('claim', [])] : [call('settle', [quoteId, account]), call('claim', [])];
      amount = snapshot.credit + (position!.settled ? 0n : position!.paid);
      recipient = account;
      reviewLabel = 'Receive available contract credit';
    } else {
      requireThat(merchant, 'relay_merchant_required', undefined, 403);
      if (b.state === 1 && b.funded === b.total && snapshot.timestamp < b.captureDeadline) {
        calls = [call('capture', [quoteId])];
        reviewLabel = 'Capture the fully funded booking';
      } else {
        const eligible = snapshot.positions.find(position => !position.settled && !position.disputed && position.paid > 0n);
        if (b.state === 2 && snapshot.timestamp >= b.capturedAt + b.window && eligible) {
          calls = [call('settle', [quoteId, eligible.account]), call('claim', [])];
          amount = snapshot.credit + eligible.paid;
          reviewLabel = 'Settle a share and receive merchant credit';
        } else {
          requireThat(snapshot.credit > 0n, 'relay_payout_unavailable');
          calls = [call('claim', [])];
          amount = snapshot.credit;
          reviewLabel = 'Receive available merchant credit';
        }
        recipient = account;
      }
    }
  }
  return {quoteId, calls, binding: {
    account, chainId: 420420777, escrow, quoteId, revision: room.revision, termsHash: room.termsHash,
    recipient, amount: String(amount), fee: '0', storage: '0', walletCreation: '0',
    feePayer: 'merchant-sponsored', estimateExpiresAt: input.expiresAt, reviewLabel,
  }};
}
