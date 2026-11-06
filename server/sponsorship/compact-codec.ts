import { concat, pad, toHex, keccak256, parseSignature, slice, hexToBigInt, type Hex, type Address } from 'viem';
import { requireThat } from '../lib.js';
export type RelayCall = {
    target: Address;
    data: Hex;
};
export type RelayRequest = {
    account: Address;
    owner: Address;
    relayer: Address;
    chainId: 420420777;
    nonce: string;
    deadline: string;
    maxFee: string;
    maxStorage: string;
    calls: RelayCall[];
};
export type SignedRelayRequest = RelayRequest & {
    signature: Hex;
};
export function relayTail(calls: RelayCall[]): Hex {
    requireThat(calls.length >= 1 && calls.length <= 2, 'relay_call_count');
    const [a, b] = calls;
    return concat([pad(a.target, { size: 32 }), toHex((a.data.length - 2) / 2, { size: 32 }), pad(b?.target ?? '0x0000000000000000000000000000000000000000', { size: 32 }), toHex(b ? (b.data.length - 2) / 2 : 0, { size: 32 }), a.data, b?.data ?? '0x']);
}
export function relayAuthorization(r: RelayRequest) { return { domain: { chainId: r.chainId, verifyingContract: r.account }, types: { AtomicPayment: [{ name: 'dataHash', type: 'bytes32' }, { name: 'relayer', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }, primaryType: 'AtomicPayment' as const, message: { dataHash: keccak256(relayTail(r.calls)), relayer: r.relayer, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) } }; }
export function relayExecution(r: SignedRelayRequest): Hex { const s = parseSignature(r.signature); return concat([toHex(BigInt(r.deadline), { size: 32 }), toHex(BigInt(r.nonce), { size: 32 }), toHex(s.v ?? BigInt(27 + s.yParity!), { size: 32 }), s.r, s.s, relayTail(r.calls)]); }
export function decodeRelayExecution(raw: Hex) {
    requireThat(/^0x(?:[a-f0-9]{2})+$/i.test(raw) && (raw.length - 2) / 2 >= 292 && (raw.length - 2) / 2 <= 33056, 'invalid_compact_envelope');
    const word = (i: number) => slice(raw, i * 32, (i + 1) * 32), num = (i: number) => hexToBigInt(word(i));
    const al = Number(num(6)), bl = Number(num(8));
    requireThat(Number.isSafeInteger(al) && Number.isSafeInteger(bl) && al >= 4 && (bl === 0 || bl >= 4) && 288 + al + bl === (raw.length - 2) / 2, 'invalid_compact_lengths');
    const target = (i: number) => { requireThat(/^0x0{24}/i.test(word(i)), 'invalid_compact_target'); return ('0x' + word(i).slice(-40)) as Address; };
    const calls: RelayCall[] = [{ target: target(5), data: slice(raw, 288, 288 + al) }];
    if (bl)
        calls.push({ target: target(7), data: slice(raw, 288 + al) });
    else
        requireThat(num(7) === 0n, 'invalid_empty_target');
    const v = num(2);
    requireThat(v === 27n || v === 28n, 'invalid_compact_signature');
    return { nonce: String(num(1)), deadline: String(num(0)), calls, signature: concat([word(3), word(4), toHex(v, { size: 1 })]) };
}
