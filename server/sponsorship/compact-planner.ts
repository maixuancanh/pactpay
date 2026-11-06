import { readFileSync } from 'node:fs';
import { encodeFunctionData, encodeAbiParameters, keccak256, toHex, hashTypedData, parseAbi, type Address, type Hex, type Abi } from 'viem';
import { requireThat } from '../lib.js';
import type { Row } from '../db/database.js';
import type { RelayCall } from './compact-codec.js';
export const relayPlannerAbi = JSON.parse(readFileSync(new URL('../payments/v1-abi.json', import.meta.url), 'utf8')) as Abi;
const tokenAbi = parseAbi(['function approve(address,uint256) returns(bool)']);
export type RelayAction = 'publish' | 'payment' | 'merchant-payout' | 'refund' | 'cancel';
export type Quote = {
    merchant: Address;
    token: Address;
    nonce: bigint;
    termsHash: Hex;
    membersHash: Hex;
    sharesHash: Hex;
    total: bigint;
    fundingDeadline: bigint;
    captureDeadline: bigint;
};
export type RelaySnapshot = {
    quote: Quote;
    state: number;
    held: bigint;
    members: Address[];
    share: bigint;
    contribution: bigint;
    credit: bigint;
    timestamp: bigint;
};
const quoteTypes = { Quote: [{ name: 'merchant', type: 'address' }, { name: 'token', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'termsHash', type: 'bytes32' }, { name: 'membersHash', type: 'bytes32' }, { name: 'sharesHash', type: 'bytes32' }, { name: 'total', type: 'uint256' }, { name: 'fundingDeadline', type: 'uint64' }, { name: 'captureDeadline', type: 'uint64' }] };
export function quoteDigest(escrow: Address, q: Quote) { return hashTypedData({ domain: { name: 'PactPay', version: '1', chainId: 420420777, verifyingContract: escrow }, types: quoteTypes, primaryType: 'Quote', message: q }); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function buildRelayPlan(x: {
    room: Row;
    account: Address;
    action: RelayAction;
    escrow: Address;
    token: Address;
    snapshot?: RelaySnapshot;
    now: number;
    expiresAt: number;
}) {
    requireThat(Buffer.byteLength(x.room.canonicalTerms ?? '', 'utf8') <= 16000, 'relay_terms_too_large');
    const r = x.room, members = r.members as Row[];
    requireThat(r.termsHash && r.canonicalTerms && keccak256(toHex(r.canonicalTerms)) === r.termsHash, 'relay_terms_changed', undefined, 409);
    requireThat(members.length >= 1 && members.length <= 5 && members.every(m => m.acceptedRevision === r.revision), 'relay_roster_consent_required');
    const addresses = members.map(m => m.accountAddress as Address), shares = members.map(m => BigInt(m.share));
    requireThat(new Set(addresses.map(a => a.toLowerCase())).size === addresses.length && shares.every(a => a > 0n) && shares.reduce((a, b) => a + b, 0n) === BigInt(r.total), 'relay_invalid_roster');
    const hashMembers = keccak256(encodeAbiParameters([{ type: 'address[]' }], [addresses])), hashShares = keccak256(encodeAbiParameters([{ type: 'uint256[]' }], [shares]));
    let q: Quote, id: Hex, calls: RelayCall[], amount: bigint;
    const call = (name: string, args: readonly unknown[]) => ({ target: x.escrow, data: encodeFunctionData({ abi: relayPlannerAbi, functionName: name, args }) });
    if (x.action === 'publish') {
        requireThat(['locked', 'publishing'].includes(r.status) && same(r.merchantAccountAddress, x.account), 'relay_merchant_required', undefined, 403);
        q = { merchant: x.account, token: x.token, nonce: BigInt(keccak256(toHex('pactpay:room:' + r.id + ':' + r.revision))), termsHash: r.termsHash, membersHash: hashMembers, sharesHash: hashShares, total: BigInt(r.total), fundingDeadline: BigInt(Math.floor(Date.parse(r.fundingDeadline) / 1000)), captureDeadline: BigInt(Math.floor(Date.parse(r.serviceAt) / 1000)) };
        requireThat(q.fundingDeadline > BigInt(Math.floor(x.now / 1000)), 'relay_funding_closed');
        id = quoteDigest(x.escrow, q);
        amount = q.total;
        calls = [call('createQuoteNativeWithTerms', [q, addresses, shares, r.canonicalTerms])];
    }
    else {
        const s = x.snapshot;
        requireThat(s && r.quote && r.quote.chainId === 420420777 && same(r.quote.escrow, x.escrow), 'relay_finalized_quote_required');
        q = s.quote;
        id = r.quote.quoteId;
        requireThat(Math.abs(x.now - Number(s.timestamp) * 1000) <= 180000 && same(q.token, x.token) && same(q.merchant, r.merchantAccountAddress) && q.termsHash === r.termsHash && q.total === BigInt(r.total) && quoteDigest(x.escrow, q) === id && q.membersHash === hashMembers && q.sharesHash === hashShares && s.members.length === addresses.length && s.members.every((a, i) => same(a, addresses[i])) && q.fundingDeadline === BigInt(Math.floor(Date.parse(r.fundingDeadline) / 1000)) && q.captureDeadline === BigInt(Math.floor(Date.parse(r.serviceAt) / 1000)), 'relay_snapshot_mismatch', undefined, 409);
        const member = members.find(m => same(m.accountAddress, x.account));
        if (member)
            requireThat(BigInt(member.share) === s.share, 'relay_share_mismatch');
        if (x.action === 'payment') {
            requireThat(member && s.share > 0n && s.state === 1 && s.contribution === 0n && s.timestamp < q.fundingDeadline, 'relay_payment_unavailable');
            amount = s.share;
            calls = [{ target: x.token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [x.escrow, amount] }) }, call('contribute', [id, q.termsHash])];
        }
        else if (x.action === 'cancel') {
            requireThat(same(q.merchant, x.account) && [1, 2].includes(s.state), 'relay_cancel_unavailable');
            amount = 0n;
            calls = [call('cancel', [id])];
        }
        else if (x.action === 'merchant-payout') {
            requireThat(same(q.merchant, x.account), 'relay_merchant_required', undefined, 403);
            if (s.state === 2 && s.held === q.total && s.timestamp < q.captureDeadline) {
                amount = s.held + s.credit;
                calls = [call('capture', [id]), call('claim', [id])];
            }
            else {
                requireThat(s.state === 3 && s.credit > 0n, 'relay_payout_unavailable');
                amount = s.credit;
                calls = [call('claim', [id])];
            }
        }
        else {
            requireThat(member, 'relay_member_required', undefined, 403);
            const expired = (s.state === 1 && s.timestamp >= q.fundingDeadline) || (s.state === 2 && s.timestamp >= q.captureDeadline);
            if (expired && s.contribution > 0n) {
                amount = s.contribution + s.credit;
                calls = [call('expire', [id]), call('claim', [id])];
            }
            else {
                requireThat(s.credit > 0n, 'relay_refund_unavailable');
                amount = s.credit;
                calls = [call('claim', [id])];
            }
        }
    }
    return { quoteId: id, calls, binding: { account: x.account, chainId: 420420777, escrow: x.escrow, quoteId: id, revision: r.revision, termsHash: q.termsHash, recipient: x.action === 'payment' || x.action === 'publish' || x.action === 'cancel' ? x.escrow : x.account, amount: String(amount), fee: '0', storage: '0', walletCreation: '0', feePayer: 'merchant-sponsored', estimateExpiresAt: x.expiresAt } };
}
