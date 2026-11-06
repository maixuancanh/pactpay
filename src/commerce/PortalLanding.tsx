import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowRight,ArrowUpRight,Check,CheckCheck,ChevronDown,FileCheck2,Link2,LockKeyhole,Pause,Play,RotateCcw,ShieldCheck,Sparkles,Users,Wallet} from 'lucide-react';

const art='/art/pactpay';

/** Decorative movement only: signing and transaction state stay in the existing workspace. */
export function usePortalMotion(){
  const [paused,setPaused]=useState(false);
  useEffect(()=>{
    const root=document.querySelector('.pp-app');
    if(!root)return;
    root.classList.toggle('pp-motion-paused',paused);
  },[paused]);
  return {paused,toggle:()=>setPaused(value=>!value)};
}

export function PortalHero({signedIn,onStart,paused,onToggleMotion}:{signedIn:boolean;onStart:()=>void;paused:boolean;onToggleMotion:()=>void}){
  return <>
    <section className="pt-banner" aria-label="PactPay on Portaldot">
      <div className="pt-banner-art" aria-hidden="true"><img src={`${art}/portal-pal.webp`} alt="" width="150" height="150"/><i/><i/></div>
      <div className="pt-banner-copy"><h2>Collect for a <span>shared booking.</span></h2><p>Collect fixed contributions for a shared booking, with agreed terms and a clear funding deadline.</p><small className="pt-network-label">Portaldot testnet</small></div>
      <button className="pp-primary" onClick={onStart}>Let’s make a plan <ArrowRight size={18}/></button>

    </section>
    <section className="pt-hero" aria-labelledby="pt-title">
      <div className="pt-hero-copy">
        <h1 id="pt-title">One booking.<br/>Every share.<br/><span className="pt-underline">Accounted for.</span></h1>
        <p>PactPay collects individual contributions for a shared booking. Agree on the amount and terms, pay your fixed share, and follow the funds through collection, payout or refund.</p>
        <div className="pt-hero-actions"><button className="pp-primary" onClick={onStart}>{signedIn?'Create a booking':'Get your group started'}<ArrowRight size={19}/></button><a className="pp-secondary" href={signedIn?'#pp-bookings':'#pt-preview'}><Play size={16} fill="currentColor"/>{signedIn?'Your bookings':'Explore a booking'}</a></div>
        <div className="pt-hero-social"><div className="pt-avatar-stack" aria-hidden="true">{['planner','maker','explorer','companion'].map(name=><span key={name}><img src={`${art}/avatar-${name}.webp`} alt="" width="38" height="38"/></span>)}</div></div>
      </div>
      <div className="pt-hero-scene" aria-label="PactPay friends planning and sharing a payment">
        <div className="pt-scene-blob"/><div className="pt-portal-ring pt-ring-one"/><div className="pt-portal-ring pt-ring-two"/><span className="pt-marker pt-hero-note">AGREED SHARES.<br/>ESCROW PAYMENTS.<svg viewBox="0 0 90 40" aria-hidden="true"><path d="M3 4Q8 35 65 22M54 12l14 10-12 11"/></svg></span><span className="pt-burst pt-hero-burst">INDIVIDUAL<br/>REFUND<br/>CLAIMS.</span>

        <span className="pt-spark pt-spark-one" aria-hidden="true">✦</span><span className="pt-spark pt-spark-two" aria-hidden="true">✧</span>
        <img className="pt-hero-characters" src={`${art}/portal-friends.webp`} width="800" height="650" alt="Three PactPay friends: a planner with a receipt, a portal companion and a friend with a shared booking." fetchPriority="high"/>

        <div className="pt-floating-receipt"><div className="pt-receipt-heading"><span>Sample group booking</span></div><strong>3 people. <span>All agreed.</span></strong><div className="pt-striped-progress"><span/></div><div className="pt-mini-stats"><div>INVITED<b>3 friends</b></div><div>SHARES<b>Agreed</b></div><div>NEXT UP<b>Review & pay</b></div></div></div>
        <button type="button" className="pt-motion-toggle" onClick={onToggleMotion} aria-pressed={paused} aria-label={paused?'Resume decorative motion':'Pause decorative motion'}>{paused?<Play size={15}/>:<Pause size={15}/>}</button>
      </div>
    </section>
    <div className="pt-marquee-wrap" aria-label="Plan together. Agree first. Every share counts."><div className="pt-marquee" aria-hidden="true">{[0,1].map(n=><div key={n}><span>FIXED SHARES</span><i>✦</i><span>COLLECT IN ESCROW</span><i>✦</i><span>CLAIM PAYOUTS &amp; REFUNDS</span><i>✦</i><span>PORTALDOT TESTNET</span><i>✦</i></div>)}</div></div>
  </>;
}

const previewTabs=['The room','Your share','The receipt'] as const;
function BookingPreview(){
  const [tab,setTab]=useState(0);
  const buttons=useRef<(HTMLButtonElement|null)[]>([]);
  return <section className="pt-section pt-preview pt-reveal" id="pt-preview" aria-labelledby="pt-preview-title">
    <div className="pt-section-heading pt-centered"><h2 id="pt-preview-title">Same page. <span className="pt-underline">Less chasing.</span></h2><p>Explore a sample room, a member’s payment review and its receipt. This illustration does not create a booking or send a payment.</p></div>
    <div className="pt-preview-tabs" role="tablist" aria-label="Explore a sample booking">{previewTabs.map((label,i)=><button key={label} ref={node=>{buttons.current[i]=node;}} type="button" role="tab" id={`pt-tab-${i}`} aria-selected={tab===i} aria-controls={`pt-panel-${i}`} tabIndex={tab===i?0:-1} onClick={()=>setTab(i)} onKeyDown={e=>{let next=tab;if(e.key==='ArrowRight')next=(tab+1)%3;else if(e.key==='ArrowLeft')next=(tab+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;else return;e.preventDefault();setTab(next);buttons.current[next]?.focus();}}>{i===0?<Users size={17}/>:i===1?<Wallet size={17}/>:<FileCheck2 size={17}/>} {label}</button>)}</div>
    <div className="pt-browser-frame"><div className="pt-browser-bar"><span className="pt-browser-dots"><i/><i/><i/></span><span><LockKeyhole size={11}/> pactpay / a plan worth sharing</span><span className="pt-preview-disclosure">Illustrative preview · demo dUSD</span></div><div className="pt-preview-content" role="tabpanel" id={`pt-panel-${tab}`} aria-labelledby={`pt-tab-${tab}`} tabIndex={0} key={tab}>
      <aside className="pt-preview-sidebar"><span className="pt-preview-logo">p<span>PactPay</span></span><div className="pt-preview-selected"><Users size={16}/>Group bookings</div><div><FileCheck2 size={16}/>Receipts</div><div><ShieldCheck size={16}/>My account</div><img src={`${art}/preview-guide.webp`} alt="" loading="lazy" width="160" height="180"/></aside>
      <div className="pt-preview-main"><h3>{tab===0?'The pottery crew':tab===1?'Your piece of the plan':'A receipt you can check.'}</h3><p>{tab===0?'An example workshop booking: 3 members, each contributing 10.00 demo dUSD.':tab===1?'The terms and your exact share, together in one review.':'Payment records and service delivery are different things.'}</p>
        {tab===0?<><div className="pt-preview-facts"><span><Users size={15}/>3 people</span><span>Saturday · 10:00</span><span>Workshop</span></div><div className="pt-preview-roster">{['Alex','Blair','Charlie'].map((name,i)=><div key={name}><span className={`pt-person pt-person-${i}`}><img src={`${art}/avatar-${['planner','maker','explorer'][i]}.webp`} alt="" width="33" height="33" loading="lazy"/></span><span><strong>{name}</strong><small>Agreed to this plan</small></span><b>10.00 <small>dUSD</small></b><span className="pt-state"><Check size={13}/>Agreed</span></div>)}</div><div className="pt-preview-note"><ShieldCheck size={18}/>Everyone reviews the same terms before the booking is locked.</div></>:tab===1?<div className="pt-sample-checkout"><div><span>YOUR FIXED SHARE</span><strong>10.00 <small>dUSD</small></strong><p>Pottery workshop · 1 place</p></div><ol><li><CheckCheck size={19}/>Read the booking terms</li><li><CheckCheck size={19}/>Review fees and permissions</li><li><Wallet size={19}/>Approve in your own wallet</li></ol><div className="pt-preview-note">Illustration only. Live fees and available signing steps are checked at checkout.</div></div>:<div className="pt-sample-receipt"><FileCheck2 size={42}/><strong>Follow the money.</strong><dl><dt>Group total</dt><dd>30.00 demo dUSD</dd><dt>Payment status</dt><dd>Shown after chain verification</dd><dt>Funds received</dt><dd>Checked separately</dd></dl><p>A booking record never promises that a service was delivered.</p></div>}
      </div><aside className="pt-preview-summary"><strong>30.00<small> demo dUSD</small></strong><div className="pt-summary-divider"/><span>3 people × 10.00</span><span>Terms agreed together</span><span>Each person stays in control</span><div className="pt-preview-status">{tab===0?'Agreed · not yet paid':tab===1?'Review before paying':'A clear record to keep'}</div><small>Example only · no transaction</small></aside>
    </div></div><p className="pt-preview-caption">Pick a tab to explore. Sign in to create your own real booking.</p>
  </section>;
}

const bookingJourney=[
  {art:'new-booking',title:'Create a booking room',detailTitle:'No payment yet',actor:'Organizer',text:'Set the total, terms and funding deadline.',state:'Room ready',detail:'Start fresh, reuse a template or review an invoice. Creating the room sends no tokens.'},
  {art:'step-agree',title:'Confirm shares & lock',detailTitle:'Everyone agrees first',actor:'Each member',text:'Confirm your amount. The organizer locks the agreed booking.',state:'Shares agreed',detail:'Every member accepts the current terms. Agreed shares must cover the total before the organizer locks the booking.'},
  {art:'feature-receipt',title:'Publish the collection',detailTitle:'Terms recorded on-chain',actor:'Organizer',text:'Publish the locked shares and terms to the payment contract.',state:'Collection open',detail:'The organizer publishes the fixed shares and terms. Locking the room alone does not open payment collection.'},
  {art:'feature-review',title:'Approve & contribute',detailTitle:'Review before sending',actor:'Each member',text:'Review costs and authorize your contribution from your wallet.',state:'Contribution recorded',detail:'Check the token permission, network fee and storage cost. Your wallet authorizes this contribution.'},
];

function BookingJourney(){return <>
  <section className="pt-section pt-journey pt-reveal" id="pt-how" aria-labelledby="pt-journey-title">
    <div className="pt-section-heading pt-centered"><h2 id="pt-journey-title">Agree together.<br/><span className="pt-underline">Pay your own share.</span></h2><p>Each step names the person responsible.</p></div>
    <ol className="pt-journey-track">{bookingJourney.map(({art:illustration,title,detailTitle,actor,text,state,detail},i)=><li className={`pt-journey-stop pt-journey-stop-${i}`} key={title}><div className="pt-journey-rail"><span>{i+1}</span><i aria-hidden="true"><ArrowRight size={21}/></i></div><div className="pt-journey-art"><img src={`${art}/${illustration}.webp`} alt="" width="230" height="160" loading="lazy"/></div><span className={`pt-actor ${actor==='Organizer'?'pt-actor-organizer':'pt-actor-member'}`}>{actor}</span><h3>{title}</h3><p>{text}</p><div className="pt-journey-note"><h4>{detailTitle}</h4><p>{detail}</p></div></li>)}</ol>
  </section>
  <section className="pt-section pt-settlement pt-reveal" id="pt-features" aria-labelledby="pt-settlement-title"><div className="pt-section-heading pt-centered"><h2 id="pt-settlement-title">Where your <span className="pt-underline">money goes.</span></h2><p>Escrow holds the contributions. The collection’s outcome determines who can claim.</p></div>
    <div className="pt-settlement-map"><div className="pt-settlement-source"><img src={`${art}/feature-consent.webp`} alt="" width="155" height="155" loading="lazy"/><strong>Booking escrow</strong><span>Contributions held here</span></div><div className="pt-settlement-fork" aria-hidden="true"><span/><ArrowRight size={22}/><ArrowRight size={22}/></div><div className="pt-settlement-outcomes"><article className="pt-outcome-payout"><img src={`${art}/control-outcome.webp`} alt="" width="112" height="112" loading="lazy"/><div><span className="pt-actor pt-actor-organizer">Organizer / merchant</span><h3>Fully funded?</h3><strong>Capture <ArrowRight size={15}/> Claim payout</strong><p>Capture before its deadline, then claim the merchant credit.</p></div></article><article className="pt-outcome-refund"><img src={`${art}/feature-refund.webp`} alt="" width="112" height="112" loading="lazy"/><div><span className="pt-actor pt-actor-member">Each contributor</span><h3>Cancelled or expired?</h3><strong>Refund credit <ArrowRight size={15}/> Claim refund</strong><p>After cancellation or expiry is processed, claim your available refund.</p></div></article></div></div>
    <div className="pt-settlement-receipt"><img src={`${art}/control-cost.webp`} alt="" width="60" height="60" loading="lazy"/><div><strong>A claim completes the transfer.</strong><p>Tokens arrive in the recipient’s account after a successful claim.</p></div></div>

  </section>
</>;}

export function PortalSections({onStart}:{onStart:()=>void}){
  return <div className="pt-marketing">
    <BookingPreview/>
    <BookingJourney/>
    <section className="pt-section pt-faq pt-reveal" id="pt-faq"><div className="pt-section-heading pt-centered"><h2>Booking and payment <span className="pt-underline">questions.</span></h2></div><div className="pt-faq-list">{[
      ['What does PactPay actually do?','PactPay coordinates fixed contributions for a shared booking: a group agrees on the terms, the merchant opens a collection, members contribute to escrow, and eligible recipients claim payout or refund credit. It is not a marketplace that finds or delivers the service.'],
      ['How many people can join?','The current payment contract supports 1–5 member addresses per collection. Their fixed shares must cover the booking total before the organizer can lock the room.'],
      ['Does signing in or agreeing move money?','No. Google sign-in restores access to your account. Agreeing acknowledges the current booking revision. Payment requires a separate review and wallet authorization. Existing-wallet orders remain attached to their original accounts.'],
      ['Can the price or members change after agreement?','Draft changes invalidate earlier acceptances. Members must agree to the new revision before locking. Once published, the contract’s member addresses, shares and terms are fixed for that collection.'],
      ['When can contributions be withdrawn or refunded?','During the funding state, a contributor may withdraw before the funding deadline. This stops once the collection is fully funded and ready. Merchant cancellation or an expiry transaction creates refund credit for eligible contributors, who then claim it. The app checks which actions are available.'],
      ['Are payments free or always one signature?','No such guarantee is made. The payment review shows the available signing path and quotes network fees and storage separately from the booking amount. Merchant sponsorship and combined execution are used only where the deployment supports and has verified them.'],
      ['Which information becomes public?','The signed-in room controls access to its group details. Terms published with a collection, account addresses and payment activity are public on-chain. Do not include names, emails or sensitive information in public terms. Receipts reflect the records available in their stated history coverage.'],
      ['Does escrow guarantee the service?','No. PactPay records payments, not service delivery. The current contract has no automatic dispute process after capture, and a support request does not reverse a payout.'],
      ['Is this real money?','This is a Portaldot testnet prototype using demo dUSD, which has no monetary backing. Native testnet tPOT pays supported network fees and storage deposits.'],
    ].map(([q,a])=><details key={q}><summary>{q}<ChevronDown size={20}/></summary><p>{a}</p></details>)}</div></section>
    <section className="pt-final pt-reveal"><div><h2>Start with the booking.<br/>Agree on <span className="pt-underline">each share.</span></h2><p>Set the total and terms. Invite your members to review them.</p><button className="pp-primary" onClick={onStart}>Start a group booking<ArrowRight size={18}/></button><small>Portaldot testnet · Demo dUSD · No payment to create a room.</small></div><img src={`${art}/final-adventure.webp`} alt="A scooter packed for a shared booking" loading="lazy" width="300" height="340"/><span className="pt-spark" aria-hidden="true">✦</span></section>
  </div>;
}
