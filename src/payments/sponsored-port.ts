import { hashTypedData, isAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { api } from '../commerce/api';
import { fingerprint } from '../flows/engine';
import type { FlowBinding, FlowKind } from '../flows/types';
import { compactAuthorization } from './compact-account';
export type RelayIntent = {
    id: string;
    status: 'quoted' | 'submitting' | 'submitted' | 'unknown' | 'finalized' | 'failed' | 'released';
    kind: Exclude<FlowKind, 'approval'>;
    account: Address;
    owner: Address;
    chainId: number;
    relayer: Address;
    nonce: string;
    deadline: string;
    calls: {
        target: Address;
        data: Hex;
    }[];
    binding: FlowBinding;
    txHash?: Hex;
    actualExecution?: string;
    actualStorage?: string;
    error?: string;
    settlementPending?: boolean;
};
export type Sponsorship = {
    available: boolean;
    reason?: string;
    budget?: {
        remaining: string;
    };
    activeIntent?: RelayIntent;
};
type Typed = ReturnType<typeof compactAuthorization>;
export type SponsoredPortConfig = {
    roomId: string;
    kind: Exclude<FlowKind, 'approval'>;
    revision: number;
    termsHash: string | null;
    account: Address;
    owner: Address;
    chainId: number;
    signer: {
        identity(): Promise<{
            account: Address;
            chainId: number;
        }>;
        signTypedData(typed: Typed): Promise<Hex>;
    };
    request?: (path: string, method?: string, body?: unknown) => Promise<unknown>;
    now?: () => number;
};
export const sponsoredPending = (intent: RelayIntent) => ['submitting', 'submitted', 'unknown'].includes(intent.status);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** The server owns reservations and broadcast recovery. Browser retries never repeat a submit. */
export function createSponsoredPort(c: SponsoredPortConfig) {
    const request = c.request ?? api, now = c.now ?? Date.now, base = '/rooms/' + encodeURIComponent(c.roomId);
    let current: RelayIntent | undefined, attempted = false, busy = false;
    const clone = (v: RelayIntent): RelayIntent => structuredClone(v);
    function validate(v: RelayIntent, quoted = false) {
        if (!v.id || v.kind !== c.kind || !same(v.account, c.account) || !same(v.owner, c.owner) || v.chainId !== c.chainId || c.chainId !== 420420777 || !isAddress(v.relayer) || !same(v.binding.account, c.account) || v.binding.chainId !== c.chainId || v.binding.revision !== c.revision || v.binding.termsHash !== c.termsHash)
            throw Error('Sponsored account, owner, network or booking changed.');
        if (quoted && (v.status !== 'quoted' || !/^[0-9]+$/.test(v.nonce) || !/^[0-9]+$/.test(v.deadline) || BigInt(v.deadline) <= BigInt(Math.floor(now() / 1000)) || v.binding.estimateExpiresAt <= now() || v.calls.length < 1 || v.calls.length > 2 || v.calls.some(call => !isAddress(call.target) || same(call.target, c.account) || !/^0x(?:[a-f0-9]{2}){4,}$/i.test(call.data)) || !['amount', 'fee', 'storage', 'walletCreation'].every(key => /^[0-9]+$/.test(v.binding[key as keyof FlowBinding] as string))))
            throw Error('Sponsored quote expired or exact calls are invalid.');
    }
    const typed = (v: RelayIntent) => compactAuthorization(v.account, v.chainId, v.calls, v.relayer, BigInt(v.nonce), BigInt(v.deadline));
    const snapshot = (v: RelayIntent) => JSON.stringify([v.id, v.kind, v.owner.toLowerCase(), fingerprint(v.binding), hashTypedData(typed(v))]);
    async function read() { if (!current)
        throw Error('No sponsored intent to check.'); const response = await request(base + '/sponsored-intents/' + encodeURIComponent(current.id)) as {
        intent: RelayIntent;
    }; validate(response.intent); current = clone(response.intent); return clone(current); }
    return {
        async load() { const status = await request(base + '/sponsorship') as Sponsorship; if (status.activeIntent) {
            validate(status.activeIntent);
            current = clone(status.activeIntent);
        } return status; },
        async review() {
            if (busy || attempted || (current && sponsoredPending(current)))
                throw Error('Check the previous sponsored execution before trying again.');
            busy = true;
            try {
                if (current?.status === 'quoted') {
                    await read();
                }
                else {
                    const status = await request(base + '/sponsorship') as Sponsorship;
                    if (status.activeIntent) {
                        validate(status.activeIntent);
                        current = clone(status.activeIntent);
                        if (sponsoredPending(current))
                            throw Error('Check the previous sponsored execution before trying again.');
                    }
                    if (!current || ['released', 'failed'].includes(current.status)) {
                        if (!status.available)
                            throw Error(status.reason ?? 'Merchant sponsorship is unavailable.');
                        const response = await request(base + '/sponsored-intents', 'POST', { kind: c.kind, idempotencyKey: [c.roomId, c.revision, c.kind, c.account, crypto.randomUUID()].join(':') }) as {
                            intent: RelayIntent;
                        };
                        current = clone(response.intent);
                    }
                }
                validate(current!, true);
                return clone(current!);
            }
            finally {
                busy = false;
            }
        },
        async submit(review: RelayIntent) {
            if (busy || attempted || (current && sponsoredPending(current)))
                throw Error('Check the previous sponsored execution before trying again.');
            busy = true;
            try {
                if (!current)
                    throw Error('Review the sponsored payment first.');
                validate(review, true);
                const before = await read();
                validate(before, true);
                if (snapshot(before) !== snapshot(review))
                    throw Error('Sponsored payment changed. Review again.');
                const identity = await c.signer.identity();
                if (identity.chainId !== c.chainId || !same(identity.account, c.owner))
                    throw Error('Google signing wallet or network changed.');
                const authorization = typed(before), signature = await c.signer.signTypedData(authorization);
                if (!same(await recoverTypedDataAddress({ ...authorization, signature }), c.owner))
                    throw Error('Invalid sponsored owner signature.');
                const after = await read();
                validate(after, true);
                const identityAfter = await c.signer.identity();
                if (snapshot(after) !== snapshot(review) || identityAfter.chainId !== c.chainId || !same(identityAfter.account, c.owner))
                    throw Error('Sponsored payment or wallet changed during authorization.');
                attempted = true;
                current = { ...after, status: 'unknown' };
                const response = await request(base + '/sponsored-intents/' + encodeURIComponent(after.id) + '/submit', 'POST', { signature }) as {
                    intent: RelayIntent;
                };
                validate(response.intent);
                current = clone(response.intent);
                return clone(current);
            }
            finally {
                busy = false;
            }
        },
        check: read,
        async cancel() { if (busy || current?.status !== 'quoted')
            throw Error('Only an unsubmitted quote can be released.'); busy = true; try {
            const fresh = await read();
            if (fresh.status !== 'quoted')
                throw Error('The server must reconcile this execution.');
            const response = await request(base + '/sponsored-intents/' + encodeURIComponent(fresh.id) + '/cancel', 'POST', {}) as {
                intent: RelayIntent;
            };
            validate(response.intent);
            current = clone(response.intent);
            return clone(current);
        }
        finally {
            busy = false;
        } },
    };
}
