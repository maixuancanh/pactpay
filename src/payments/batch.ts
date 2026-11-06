import { encodeFunctionData, parseAbi, isAddress, type Address } from 'viem';
import { verifiedCapability, type Capability } from './wallet-capabilities';
export type BatchCall = { to: Address; data: `0x${string}`; value: bigint };
export function prepareApproveContributeBatch(input: { capability: Capability; chainId: number; account: Address; member: Address; token: Address; escrow: Address; quoteId: `0x${string}`; termsHash: `0x${string}`; share: bigint; deadline: number; now: number; storageCovered: boolean }): readonly BatchCall[] {
 const { capability: c, chainId, account, member, token, escrow, share, quoteId } = input;
 if (!verifiedCapability(c, chainId, account) || !c.atomic || !c.preservesOrigin || !c.oneAuthorization || !c.primitive) throw Error('Atomic origin-preserving batch is not verified for this account');
 if (![account,member,token,escrow].every(a=>isAddress(a)) || account.toLowerCase() !== member.toLowerCase()) throw Error('Batch signer must be the quoted member');
 if (share <= 0n || !/^0x[0-9a-fA-F]{64}$/.test(quoteId) || input.now >= input.deadline || !input.storageCovered) throw Error('Quote expired or cost coverage unavailable');
 return [{ to: token, data: encodeFunctionData({ abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']), functionName: 'approve', args: [escrow, share] }), value: 0n }, { to: escrow, data: encodeFunctionData({ abi: parseAbi(['function contribute(bytes32 quoteId, bytes32 expectedTermsHash)']), functionName: 'contribute', args: [quoteId,input.termsHash] }), value: 0n }];
}
