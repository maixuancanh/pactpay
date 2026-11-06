import {useEffect, useState} from 'react';
import {formatUnits} from 'viem';
import {api} from './api';
import {receiptEventLabels, receiptSummary, type ReceiptEvent, type ReceiptSnapshot} from './booking-receipt';
import './booking-evidence.css';
import '../native/native.css';

type Event = ReceiptEvent & {chain_id: string; escrow: string; quote_id: string; block_hash: string; source: string; coverage: unknown};
type Response = {events: Event[]; snapshot?: ReceiptSnapshot & {blockHash: string}};
const format = (value: bigint | null) => value === null ? 'Not verified' : formatUnits(value, 6) + ' demo dUSD';

export default function PublicIndexedReceipt() {
  const params = new URLSearchParams(location.search);
  const chain = params.get('chainId') ?? '';
  const escrow = params.get('escrow') ?? '';
  const quote = params.get('quoteId') ?? '';
  const valid = /^[1-9]\d*$/.test(chain) && /^0x[0-9a-f]{40}$/i.test(escrow) && /^0x[0-9a-f]{64}$/i.test(quote);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    void api<Response>(`/receipts/${chain}/${escrow}/${quote}`, 'GET', undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.events.some(event => String(event.chain_id) !== chain || event.escrow.toLowerCase() !== escrow.toLowerCase() || event.quote_id.toLowerCase() !== quote.toLowerCase())) {
        throw Error('Receipt identity mismatch');
      }
      setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [valid, chain, escrow, quote, refresh]);

  const summary = data?.snapshot ? receiptSummary(data.snapshot, data.events) : null;
  return <main className="native-app">
    <header className="native-header"><a href="/booking">PactPay bookings</a></header>
    <section className="native-panel pp-booking-evidence">
      <h1>Booking payment receipt</h1>
      <p>View finalized payment evidence without signing in or connecting a wallet.</p>
      {!valid && <p role="alert">This receipt link is incomplete or invalid.</p>}
      {valid && !data && !error && <p role="status">Checking finalized payments…</p>}
      {error && <div role="alert"><p>Payment evidence is currently unavailable. The payment status is unknown.</p>
        <button onClick={() => {setError(false); setRefresh(n => n + 1);}}>Try again</button>
      </div>}
      {summary && data?.snapshot && <>
        <dl className="pp-receipt-totals">
          <div><dt>Booking total</dt><dd>{format(BigInt(data.snapshot.total))}</dd></div>
          <div><dt>Contributed</dt><dd>{format(summary.contributed)}</dd></div>
          <div><dt>Held for settlement</dt><dd>{format(summary.held)}</dd></div>
          {data.snapshot.merchantCredit !== undefined && <div><dt>Organizer can receive across bookings</dt><dd>{format(BigInt(data.snapshot.merchantCredit))}</dd></div>}
        </dl>
        <h2>Individual shares</h2>
        <ol className="pp-receipt-members">{summary.members.map((member, index) => <li key={member.account}>
          <h3>Member {index + 1}</h3>
          <dl className="pp-receipt-totals">
            <div><dt>Agreed</dt><dd>{format(BigInt(member.share))}</dd></div>
            <div><dt>Contributed</dt><dd>{format(member.paid)}</dd></div>
            <div><dt>Held</dt><dd>{format(member.held)}</dd></div>
            <div><dt>Allocated to refund</dt><dd>{format(member.refund)}</dd></div>
            <div><dt>Allocated to merchant</dt><dd>{format(member.payout)}</dd></div>
            {member.contractCredit !== undefined && <div><dt>Member can receive across bookings</dt><dd>{format(BigInt(member.contractCredit))}</dd></div>}
            <div><dt>Transferred for this booking</dt><dd>{format(member.transferred)}</dd></div>
          </dl>
          {member.disputed && !member.settled && <p>Complaint open. This share is held.</p>}
        </li>)}</ol>
        <p>Wallet credits and transfers can cover several bookings. Allocation shows who the money was assigned to. A transfer for this booking needs separate evidence.</p>
      </>}
      {data && <>
        <h2>Payment timeline</h2>
        <p>{data.events.length ? 'Recorded finalized events. Coverage may be partial.' : 'No events have been indexed for this booking. Missing events leave the payment history unknown.'}</p>
        <ol>{data.events.map(event => <li key={event.tx_hash + ':' + event.log_index}>
          <h3>{receiptEventLabels[event.kind] ?? 'Payment activity'}</h3>
          {typeof event.payload.amount === 'string' && /^\d+$/.test(event.payload.amount) && <p>{format(BigInt(event.payload.amount))}</p>}
          <details><summary>Transaction details</summary><p className="pp-receipt-reference">Block {event.block_number} · {event.source}<br/>{event.tx_hash}<br/>{event.block_hash}</p></details>
        </li>)}</ol>
      </>}
      <details><summary>Booking reference</summary><p className="pp-receipt-reference">Chain {chain}<br/>Contract {escrow}<br/>Booking {quote}{data?.snapshot && <><br/>Finalized block {data.snapshot.blockNumber}<br/>{data.snapshot.blockHash}</>}</p></details>
    </section>
  </main>;
}
