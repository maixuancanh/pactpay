import { useEffect, useRef, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { formatUnits, type Address, type Hex } from 'viem';
import { useAccount } from '../account/AccountProvider';
import { api } from '../commerce/api';
import type { Room } from '../commerce/types';
import type { FlowKind } from '../flows/types';
import { createSponsoredPort, sponsoredPending, type RelayIntent, type Sponsorship } from './sponsored-port';
/** The customer signs once; the server owns broadcast, budget settlement and recovery. */
export default function SponsoredCompactCheckout({ room, kind, onFinalized }: {
    room: Room;
    kind: FlowKind;
    onFinalized: () => void;
}) {
    const { session } = useAccount(), { wallets } = useWallets(), registration = session?.atomicAccount;
    const [intent, setIntent] = useState<RelayIntent | null>(null), [availability, setAvailability] = useState<Sponsorship | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
    const port = useRef<ReturnType<typeof createSponsoredPort> | null>(null), notified = useRef(''), running = useRef(false);
    const candidates = wallets.filter(w => w.walletClientType === 'privy' && w.type === 'ethereum' && w.address.toLowerCase() === registration?.ownerAddress.toLowerCase());
    useEffect(() => {
        let disposed = false;
        setIntent(null);
        setAvailability(null);
        setError('');
        port.current = null;
        void (async () => { if (!registration || candidates.length !== 1)
            throw Error('Restore the Google wallet that owns this booking.'); const status = await api<Sponsorship>('/rooms/' + encodeURIComponent(room.id) + '/sponsorship'); const selectedKind = status.activeIntent?.kind ?? kind; if (selectedKind === 'approval')
            throw Error('Unsupported sponsored action'); const wallet = candidates[0]; const next = createSponsoredPort({ roomId: room.id, kind: selectedKind, revision: room.revision, termsHash: room.termsHash, account: registration.accountAddress as Address, owner: registration.ownerAddress as Address, chainId: 420420777, signer: { identity: async () => { const provider = await wallet.getEthereumProvider(); const [accounts, chain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]); if (!accounts.some((a: string) => a.toLowerCase() === registration.ownerAddress.toLowerCase()))
                    throw Error('Google wallet changed'); return { account: registration.ownerAddress as Address, chainId: Number(chain) }; }, signTypedData: async (typed) => (await wallet.getEthereumProvider()).request({ method: 'eth_signTypedData_v4', params: [registration.ownerAddress, JSON.stringify(typed, (_, v) => typeof v === 'bigint' ? String(v) : v)] }) as Promise<Hex> } }); const restored = await next.load(); if (!disposed) {
            port.current = next;
            setAvailability(restored);
            setIntent(restored.activeIntent ?? null);
        } })().catch(e => { if (!disposed)
            setError(e.message); });
        return () => { disposed = true; };
    }, [room.id, room.revision, room.termsHash, kind, registration?.accountAddress, registration?.ownerAddress, candidates.map(w => w.address).join(','), reload]);
    useEffect(() => { if (!intent || !sponsoredPending(intent) || busy)
        return; let disposed = false; const timer = setTimeout(() => { void port.current?.check().then(next => { if (!disposed) {
        setIntent(next);
        setError('');
    } }).catch(e => { if (!disposed)
        setError('Status check unavailable. No payment was resent. ' + e.message); }); }, 5000); return () => { disposed = true; clearTimeout(timer); }; }, [intent, busy, error]);
    useEffect(() => { if (intent?.status === 'finalized' && notified.current !== intent.id) {
        notified.current = intent.id;
        onFinalized();
    } }, [intent?.id, intent?.status, onFinalized]);
    async function run(action: () => Promise<RelayIntent>) { if (running.current)
        return; running.current = true; setBusy(true); setError(''); try {
        setIntent(await action());
    }
    catch (e) {
        setError((e as Error).message);
        try {
            if (port.current)
                setIntent(await port.current.check());
        }
        catch { }
    }
    finally {
        running.current = false;
        setBusy(false);
    } }
    return <section className="pp-form" aria-label="Sponsored checkout"><h3>{(intent?.kind??kind)==='cancel'?'Cancel this booking':(intent?.kind??kind)==='refund'?'Receive your refund':(intent?.kind??kind)==='merchant-payout'?'Receive booking funds':(intent?.kind??kind)==='publish'?'Open group payment':'Pay with your Google wallet'}</h3><p>The merchant pays network fees within their approved budget. You approve only this booking action.</p>{!availability && !error && <p role="status">Checking sponsored payment availability…</p>}{availability && !intent && <>{availability.available ? <button type="button" className="pp-primary" disabled={busy} onClick={() => void run(() => port.current!.review())}>{busy ? 'Checking payment…' : 'Review my payment'}</button> : <p role="status">{availability.reason ?? 'Merchant sponsorship is unavailable.'}</p>}</>}{intent && <><div aria-live="polite" role="status">{intent.status === 'quoted' ? 'Ready for your review' : intent.status === 'finalized' ? 'Payment action finalized' : sponsoredPending(intent) ? 'Checking network confirmation. You can return on another device.' : intent.status === 'failed' ? 'The transaction failed. Review the result before trying again.' : 'This unsubmitted quote was released.'}</div><dl><dt>Booking amount</dt><dd>{formatUnits(BigInt(intent.binding.amount), 6)} demo dUSD</dd><dt>Your network fee</dt><dd>0 tPOT · merchant sponsored</dd><dt>Merchant execution fee limit</dt><dd>{formatUnits(BigInt(intent.binding.fee), 14)} tPOT</dd><dt>Merchant storage deposit limit</dt><dd>{formatUnits(BigInt(intent.binding.storage), 14)} tPOT</dd>{intent.actualExecution !== undefined && <><dt>Actual network fee</dt><dd>{formatUnits(BigInt(intent.actualExecution), 14)} tPOT</dd></>}{intent.actualStorage !== undefined && <><dt>Actual storage charge</dt><dd>{formatUnits(BigInt(intent.actualStorage), 14)} tPOT</dd></>}</dl>{intent.status === 'quoted' && <>{intent.kind==='cancel'&&<p>Cancellation makes refunds available to contributors. It does not claim their money for them.</p>}<p>Confirm once in your wallet. This approval is limited to the booking action shown here. The merchant covers network costs within the limits above; the complete payment is checked before sending.</p><button type="button" className="pp-primary" disabled={busy || !availability?.available} onClick={() => void run(() => port.current!.submit(intent))}>{busy ? 'Waiting for wallet and relay…' : (intent.kind==='cancel'?'Confirm cancellation in my wallet':'Confirm this payment in my wallet')}</button><button type="button" className="pp-text" disabled={busy} onClick={() => void run(() => port.current!.cancel())}>Release this unused quote</button></>}{sponsoredPending(intent) && <button type="button" className="pp-secondary" disabled={busy} onClick={() => void run(() => port.current!.check())}>Check payment status</button>}{['failed', 'released'].includes(intent.status) && <button type="button" className="pp-secondary" disabled={busy||!!intent.settlementPending} onClick={() => setReload(v => v + 1)}>Start a fresh review</button>}{intent.status === 'finalized' && room.quote && <a href={`/receipt?chainId=420420777&escrow=${encodeURIComponent(room.quote.escrow)}&quoteId=${encodeURIComponent(room.quote.quoteId)}`}>View receipt</a>}{intent.settlementPending && <p>{intent.status==='failed'?'The transaction failed; merchant fee accounting is still being checked. Wait for that check before starting another attempt.':'Payment is confirmed. Merchant fee accounting is still being reconciled; no second payment is needed.'}</p>}{intent.txHash && <details><summary>Transaction reference</summary><p style={{ overflowWrap: 'anywhere' }}>{intent.txHash}</p></details>}</>}{error && <p role="alert">{error}</p>}</section>;
}
