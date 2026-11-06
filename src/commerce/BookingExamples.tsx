import {useState} from 'react';
import {formatUnits} from 'viem';
import './commerce.css';
import './booking-evidence.css';

const repository = 'https://github.com/maixuancanh/pactpay/blob/main/evidence/';
const refundReceipt = '/receipt?chainId=420420777&escrow=0x1e6b99aab17174409fcacb591542aeba6d6113d6&quoteId=0x1a203c2bcabc9609034e5831b90b918c325586f8057870c525614199776240ab';
const examples = [
  {
    id: 'funded', label: 'Everyone paid', title: 'The workshop is fully funded',
    paid: [10, 10, 10], held: 0, claimable: 0, transferred: 30,
    action: 'The organizer has claimed the payout after the complaint window.',
    evidence: {label: 'Recorded native payout claim', block: 316348, file: 'protected-v2-claim-finalized.json'},
  },
  {
    id: 'missing', label: 'One share missing', title: 'The booking missed its funding deadline',
    paid: [10, 10, 0], held: 0, claimable: 20, transferred: 0,
    action: 'The two paid shares were settled as refunds. Each contributor can now receive their own refund.',
    evidence: {label: 'Related native cancellation refund claim', block: 316585, file: 'protected-v2-refund-claim-finalized.json'},
  },
  {
    id: 'complaint', label: 'Complaint opened', title: 'One share is under review',
    paid: [10, 10, 10], held: 10, claimable: 20, transferred: 0,
    action: 'The organizer can claim the two undisputed shares. The buyer and organizer can sign a split for the disputed share. After the resolution deadline, that buyer can settle it to a refund.',
  },
] as const;

export default function BookingExamples({standalone = false}: {standalone?: boolean}) {
  const requested = new URLSearchParams(location.search).get('example');
  const [index, setIndex] = useState(() => Math.max(0, examples.findIndex(example => example.id === requested)));
  const example = examples[index];
  const amount = (value: number) => formatUnits(BigInt(value) * 1_000_000n, 6) + ' dUSD';
  return <section className="pp-panel pp-booking-evidence" id="booking-outcomes" aria-labelledby="booking-examples-title">
    {standalone && <a href="/booking#booking-outcomes">Back to PactPay bookings</a>}
    <h2 id="booking-examples-title">Try a booking outcome</h2>
    <p>Interactive simulation for a three-person workshop. Amounts and people are examples.</p>
    <div className="pp-actions" role="group" aria-label="Choose a booking outcome">
      {examples.map((item, i) => <button key={item.id} type="button" className={i === index ? 'pp-primary' : 'pp-secondary'} aria-pressed={i === index} onClick={() => setIndex(i)}>{item.label}</button>)}
    </div>
    <div aria-live="polite">
      <h3>{example.title}</h3>
      <dl className="pp-receipt-totals">
        <div><dt>Contributed</dt><dd>{amount(example.paid.reduce<number>((sum, value) => sum + value, 0))}</dd></div>
        <div><dt>Held in escrow</dt><dd>{amount(example.held)}</dd></div>
        <div><dt>Available to receive</dt><dd>{amount(example.claimable)}</dd></div>
        <div><dt>Transferred</dt><dd>{amount(example.transferred)}</dd></div>
      </dl>
      <ul className="pp-roster">{example.paid.map((value, i) => <li key={i}><strong>Member {i + 1}</strong><span>{amount(value)} contributed</span></li>)}</ul>
      <p>{example.action}</p>
    </div>
    {!standalone && <a href={`/receipt?example=${example.id}`}>Open this sample receipt</a>}
    <div className="pp-message">
      <strong>Recorded testnet evidence</strong>
      {'evidence' in example ? <p>This receipt is from a separate native wallet test. <a href={repository + example.evidence.file}>{example.evidence.label} · finalized block {example.evidence.block}</a></p> :
        <p>This preview illustrates the complaint policy. A finalized receipt for this simulated split is unavailable.</p>}
      {example.id === 'missing' && <a href={refundReceipt}>Check the recorded refund booking on V3</a>}
    </div>
  </section>;
}
