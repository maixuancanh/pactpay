import {decodeFunctionData, parseAbi, type Address} from 'viem';
import {requireThat} from '../lib.js';
import type {RelayAction} from './compact-planner.js';
import type {RelayCall} from './compact-codec.js';
import {protectedRelayAbi} from './protected-planner.js';

const approvalAbi = parseAbi(['function approve(address,uint256) returns(bool)']);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function verifyProtectedAcceptance(kind: RelayAction, calls: RelayCall[], deployment: {
  account: Address; escrow: Address; token: Address;
}) {
  requireThat(calls.length >= 1 && calls.length <= 2, 'relay_acceptance_action_mismatch');
  const decoded = calls.map(call => {
    requireThat(same(call.target, deployment.token) || same(call.target, deployment.escrow), 'relay_acceptance_target_mismatch');
    return decodeFunctionData({abi: same(call.target, deployment.token) ? approvalAbi : protectedRelayAbi, data: call.data});
  });
  const pattern = decoded.map(call => call.functionName).join(',');
  if (kind === 'payment') {
    requireThat(pattern === 'approve,contribute' && same(calls[0].target, deployment.token) &&
      same(calls[1].target, deployment.escrow), 'relay_acceptance_action_mismatch');
    const [spender, amount] = decoded[0].args as readonly [Address, bigint];
    requireThat(same(spender, deployment.escrow) && amount > 0n, 'relay_acceptance_approval_mismatch');
    return {stage: 'payment', quoteId: (decoded[1].args as readonly [string])[0], approved: amount};
  }
  requireThat(calls.every(call => same(call.target, deployment.escrow)), 'relay_acceptance_target_mismatch');
  const patterns: Record<Exclude<RelayAction, 'payment'>, string[]> = {
    publish: ['create'], cancel: ['cancel'], refund: ['settle,claim'], 'merchant-payout': ['capture', 'settle,claim'],
  };
  requireThat(patterns[kind].includes(pattern), 'relay_acceptance_action_mismatch');
  if (kind === 'refund') {
    const [, member] = decoded[0].args as readonly [string, Address];
    requireThat(same(member, deployment.account), 'relay_acceptance_member_mismatch');
  }
  return {stage: kind === 'merchant-payout' ? pattern === 'capture' ? 'capture' : 'payout' : kind};
}
