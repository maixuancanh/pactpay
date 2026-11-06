import {BookingDashboard} from './BookingDashboard';
import {ProfilePage} from '../account/ProfilePage';
import {PortalHero,PortalSections,usePortalMotion} from './PortalLanding';
import {AccountTools} from '../account/AccountTools';



import {lazy,Suspense,useCallback,useEffect,useState} from 'react';



import {ArrowRight,ArrowUpRight,Bell,CalendarDays,Check,ChevronLeft,FileText,Layers,Plus,ShieldCheck,Users,Wallet} from 'lucide-react';



import {AccountProvider,useAccount} from '../account/AccountProvider';



import {ConnectDialog} from '../account/ConnectDialog';



import {NotificationSettings} from '../account/NotificationSettings';



import {api} from './api';

import {syncEvidence} from './sync';



import {withPaymentEvidence,type IndexedEvidence} from './evidence';



import {formatAmount} from './model';



import {CreateBooking} from './CreateBooking';



import {Templates,InvoiceImport} from './Tools';



import {Support} from './Support';



import {RoomView} from './RoomView';



import {Sheet} from './Sheet';



import type {Room} from './types';



import './commerce.css';
import './portal-theme.css';
import './workspace-theme.css';



import {recordJourney} from './journey-metrics';



import {ConfiguredFlow,type CommerceFlowFactory} from './ConfiguredFlow';



const SponsoredCompactCheckout=lazy(()=>import('../payments/SponsoredCompactCheckout'));
const CompactBookingCheckout=lazy(()=>import('../payments/CompactBookingCheckout'));

const ProviderWorkspace=lazy(()=>import('./ProviderWorkspace'));



type Panel='account'|'create'|'templates'|'invoice'|'notifications'|'support'|'review'|null;



export default function BookingApp({flowFactory,onPaymentFinalized,onPaymentFailed}:{flowFactory?:CommerceFlowFactory;onPaymentFinalized?:(room:Room)=>void;onPaymentFailed?:(room:Room)=>void}={}){return <AccountProvider><ConfiguredWorkspace flowFactory={flowFactory} onPaymentFinalized={onPaymentFinalized} onPaymentFailed={onPaymentFailed}/></AccountProvider>;}



function ConfiguredWorkspace({flowFactory,onPaymentFinalized,onPaymentFailed}:{flowFactory?:CommerceFlowFactory;onPaymentFinalized?:(room:Room)=>void;onPaymentFailed?:(room:Room)=>void}){const {config,session}=useAccount();return config?.privyAppId&&config.privyAvailable?<Suspense fallback={<main role="status">Restoring your secure wallet provider…</main>}><ProviderWorkspace appId={config.privyAppId}>{configured=><BookingWorkspace key={session?.user?.id??'anonymous'} flowFactory={flowFactory??configured} onPaymentFinalized={onPaymentFinalized} onPaymentFailed={onPaymentFailed}/>}</ProviderWorkspace></Suspense>:<BookingWorkspace key={session?.user?.id??'anonymous'} flowFactory={flowFactory} onPaymentFinalized={onPaymentFinalized} onPaymentFailed={onPaymentFailed}/>;}



function BookingWorkspace({flowFactory,onPaymentFinalized,onPaymentFailed}:{flowFactory?:CommerceFlowFactory;onPaymentFinalized?:(room:Room)=>void;onPaymentFailed?:(room:Room)=>void}){const {paused,toggle}=usePortalMotion();const {session,config,loading,error,refresh,logout,connection}=useAccount();const [metricsOptIn]=useState(()=>localStorage.getItem('pactpay:journey-opt-in')==='true');const [route,setRoute]=useState(()=>location.pathname+location.search);const isProfile=route.split('?')[0]==='/booking/profile';const [connectOpen,setConnectOpen]=useState(false);const [rooms,setRooms]=useState<Room[]>([]);const [roomStale,setRoomStale]=useState(true);const [room,setRoom]=useState<Room|null>(null);const [panel,setPanel]=useState<Panel>(null);const [reviewKind,setReviewKind]=useState<'payment'|'refund'|'cancel'|null>(null);const [message,setMessage]=useState('');const [initialAmount,setInitialAmount]=useState('');const [invoiceShares,setInvoiceShares]=useState<string[]|undefined>();const [joining,setJoining]=useState(false);const [joinAtomic,setJoinAtomic]=useState(false);const [nickname,setNickname]=useState('');const [invitation,setInvitation]=useState<{token:string;userId:string;title:string;share:string|null;fundingDeadline:string}|null>(null);const params=new URLSearchParams(location.search);const roomId=params.get('room');const invite=params.get('invite');



const load=useCallback(async()=>{if(!session?.user)return;const result=await api<{rooms:Room[]}>('/rooms');const selected=roomId?(await api<{room:Room}>(`/rooms/${encodeURIComponent(roomId)}`)).room:null;let evidence:IndexedEvidence[]=[];try{evidence=await syncEvidence();}catch(e){setRooms(result.rooms);if(selected)setRoom(selected);setRoomStale(true);throw e;}setRooms(result.rooms.map(value=>withPaymentEvidence(value,evidence)));if(selected)setRoom(withPaymentEvidence(selected,evidence));setRoomStale(false);},[session?.user?.id,session?.binding?.accountAddress,roomId]);



useEffect(()=>{const back=()=>{setRoute(location.pathname+location.search);setRoom(null);setPanel(null);};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);

useEffect(()=>{load().catch(e=>{setRoomStale(true);setMessage(e.message);});},[load]);



useEffect(()=>{if(!session?.user)return;let disposed=false;let timer:ReturnType<typeof setTimeout>;let failures=0;const tick=async()=>{try{await load();failures=0;}catch{failures++;setRoomStale(true);}if(!disposed)timer=setTimeout(tick,Math.min(60000,10000*2**failures));};timer=setTimeout(tick,10000);return()=>{disposed=true;clearTimeout(timer);};},[load,session?.user?.id]);



// Logging out or a wallet change invalidates the open review immediately.



useEffect(()=>{setPanel(p=>p==='review'?null:p);},[session?.user?.id,session?.binding?.accountAddress,session?.binding?.chainId]);



function openRoom(value:Room){setRoom(value);setRooms(previous=>[value,...previous.filter(r=>r.id!==value.id)]);history.replaceState(null,'',`/booking?room=${encodeURIComponent(value.id)}`);setRoute(location.pathname+location.search);setPanel(null);window.scrollTo(0,0);}



function navigateWorkspace(view:'bookings'|'profile'){const target=view==='profile'?'/booking/profile':'/booking';history.pushState(null,'',target);setRoute(target);setRoom(null);setPanel(null);window.scrollTo(0,0);}

useEffect(()=>{
 const user=session?.user;
 if(!invite||!user)return;
 let active=true;
 setInvitation(null);
 setMessage('');
 setNickname((user.displayName||'Guest').trim().slice(0,80)||'Guest');
 setJoinAtomic(false);
 void api<{room:Room|null;preview?:{title:string;share:string|null;fundingDeadline:string}}>('/invitations/'+encodeURIComponent(invite)).then(value=>{
  if(!active)return;
  if(value.room)openRoom(value.room);
  else if(value.preview)setInvitation({...value.preview,token:invite,userId:user.id});
  else setMessage('Ask the organizer for a new invitation that includes your share.');
 }).catch(()=>{if(active)setMessage('This invitation could not be opened. Ask the organizer for a current invitation.');});
 return()=>{active=false;};
},[invite,session?.user?.id]);

const joinPreview=invitation?.token===invite&&invitation?.userId===session?.user?.id?invitation:null;

const titles:Record<NonNullable<Panel>,[string,string]>={account:['Your account','Activity, merchant budgets and privacy preferences.'],create:['Create a group booking','Set the details now. Your group agrees before money moves.'],templates:['Your booking templates','Reuse the details, with fresh dates and fresh consent.'],invoice:['Start from an invoice','You review the amount. PactPay checks the arithmetic.'],notifications:['Stay in the loop','Choose how and when booking reminders reach you.'],support:['Booking support','Track a request without confusing it with a completed refund.'],review:['Review your next step','Your wallet stays in control of every transaction.']};



return <div className={session?.user?'pp-app pd-authenticated':'pp-app'}><a className="pp-skip" href="#pp-main">Skip to booking workspace</a><header className="pp-header"><a href="/booking" className="pp-brand"><img className="pactpay-logo" src="/art/pactpay/pactpay-logo.webp" width="144" height="48" alt="PactPay"/></a>{session?.user?<nav className="pd-app-nav" aria-label="Main navigation"><a href="/booking" aria-current={!isProfile?'page':undefined} onClick={e=>{e.preventDefault();navigateWorkspace('bookings');}}>Group bookings</a><a href="/booking#pd-payments" onClick={e=>{e.preventDefault();navigateWorkspace('bookings');requestAnimationFrame(()=>document.getElementById('pd-payments')?.scrollIntoView({block:'start'}));}}>Payments & receipts</a><a href="/booking/profile" aria-current={isProfile?'page':undefined} onClick={e=>{e.preventDefault();navigateWorkspace('profile');}}>Profile</a><a href="/native">Existing wallet orders<ArrowUpRight size={13}/></a></nav>:<nav aria-label="Main navigation"><a href="/booking" aria-current="page">Group bookings</a>{!session?.user&&<><a href="/booking#pt-how">How it works</a><a href="/booking#pt-features">Funds & refunds</a><a href="/booking#pt-faq">FAQ</a></>}<a href="/native">Existing wallet orders<ArrowUpRight size={13}/></a></nav>}<div className="pp-account">{session?.user?<><button className="pp-icon" aria-label="Notification preferences" onClick={()=>setPanel('notifications')}><Bell size={18}/></button><button className="pp-text pp-account-name" onClick={()=>navigateWorkspace('profile')}><img className="pd-header-avatar" src="/art/pactpay/profile-companion.webp" alt="" width="32" height="32"/>{session.user.displayName||'My account'}</button><button className="pp-text" onClick={()=>logout().catch(e=>setMessage(e.message))}>Sign out</button></>:<><button className="pp-primary" onClick={()=>setConnectOpen(true)}><Wallet size={16}/>{connection.busy?'Connecting…':'Connect'}</button>{connection.error&&<span className="pp-connect-error" role="alert">{connection.error}</span>}</>}</div></header><main id="pp-main" className="pp-main">{session?.user&&isProfile?<ProfilePage rooms={rooms} stale={roomStale} onBookings={()=>navigateWorkspace('bookings')} onNotifications={()=>setPanel('notifications')}/>:room&&session?.user?<><button className="pp-text pp-back" onClick={()=>{setRoom(null);history.replaceState(null,'','/booking');setRoute('/booking');}}><ChevronLeft size={16}/>All bookings</button><RoomView stale={roomStale} room={room} onChange={openRoom} onSupport={()=>setPanel('support')} onReview={()=>{setReviewKind(null);setPanel('review');}} onRefund={()=>{setReviewKind('refund');setPanel('review');}} onCancel={()=>{setReviewKind('cancel');setPanel('review');}} config={config}/></>:<>{!session?.user&&<PortalHero signedIn={false} onStart={()=>setConnectOpen(true)} paused={paused} onToggleMotion={toggle}/>}{loading?<section className="pp-panel" role="status">Checking your account…</section>:!session?.user?<section id="pp-onboarding" className="pp-onboarding pp-onboarding-focused"><img className="pp-onboarding-illustration" src="/art/pactpay/step-invite.webp" alt="" width="190" height="150" loading="lazy"/><div><h2>{invite?'Review the booking you’ve been invited to.':'Start with a booking room.'}</h2><p>{invite?'Sign in to review the invitation, confirm your share and read the terms before paying.':'Create a room. Invite your members. Agree before anyone pays.'}</p></div><div className="pp-onboarding-action"><button className="pp-primary" onClick={()=>setConnectOpen(true)}><Wallet size={17}/>Connect to PactPay</button><span>Sign in with Google or choose your existing wallet.</span>{error&&<><p role="alert">{error}</p><button className="pp-secondary" onClick={()=>void refresh()}>Retry connection</button></>}</div></section>:invite?<section className="pp-panel pp-join"><h2>{joinPreview?.title??'Booking invitation'}</h2>{joinPreview?<><p>Funding closes {new Date(joinPreview.fundingDeadline).toLocaleString('en-GB')}.</p>{joinPreview.share===null?<p>Ask the organizer for a new invitation that includes your share.</p>:<form className="pp-form" onSubmit={async e=>{e.preventDefault();if(joining||!joinPreview.share||!session.binding)return;setJoining(true);try{const value=await api<{room:Room}>(`/invitations/${encodeURIComponent(invite)}/join`,'POST',{nickname,share:joinPreview.share,...(joinAtomic&&session.atomicAccount?.active?{accountAddress:session.atomicAccount.accountAddress}:{})});recordJourney(localStorage,'room_joined',metricsOptIn);openRoom(value.room);}catch(error){setMessage((error as Error).message);}finally{setJoining(false);}}}><label>Your display name<input required maxLength={80} value={nickname} onChange={e=>setNickname(e.target.value)}/></label><p>Your assigned share <strong>{formatAmount(joinPreview.share)} demo dUSD</strong></p>{session?.atomicAccount?.active&&<label className="pp-check"><input type="checkbox" checked={joinAtomic} onChange={e=>setJoinAtomic(e.target.checked)}/>Use my verified payment account for this booking. This choice stays attached to this booking.</label>}<p className="pp-muted">Review the booking terms after joining. Payment requires a separate confirmation.</p><button className="pp-primary" disabled={joining||!session.binding}>{joining?'Joining…':'Join booking room'}</button>{!session.binding&&<p className="pp-gate">Your Google account is signed in, but its canonical wallet is not ready. Wallet provisioning must be configured before joining.</p>}</form>}</>:!message&&<p role="status">Loading your invitation…</p>}</section>:<BookingDashboard rooms={rooms} userId={session.user.id} displayName={session.user.displayName||'there'} stale={roomStale} account={session.binding?.accountAddress} onReview={value=>{openRoom(value);if(value.settlementVersion==='protected-v2')return;setReviewKind('payment');setPanel('review');}} onCredit={(value,refund)=>{openRoom(value);if(value.settlementVersion==='protected-v2')return;setReviewKind(refund?'refund':null);setPanel('review');}} onCreate={()=>setPanel('create')} onTemplates={()=>setPanel('templates')} onInvoice={()=>setPanel('invoice')} onOpen={openRoom} onProfile={()=>{navigateWorkspace('profile');requestAnimationFrame(()=>document.getElementById('pd-recovery')?.scrollIntoView({block:'start'}));}} onNotifications={()=>setPanel('notifications')} onRefresh={()=>void load().catch(e=>{setRoomStale(true);setMessage(e.message);})}/>}{!session?.user&&<PortalSections onStart={()=>setConnectOpen(true)}/>}</>}{message&&<p className="pp-message" role="status">{message}</p>}</main><ConnectDialog open={connectOpen&&!session?.user} onClose={()=>setConnectOpen(false)}/><Sheet open={panel!==null} onClose={()=>setPanel(null)} title={panel?titles[panel][0]:''} description={panel?titles[panel][1]:''}>{panel==='account'&&<AccountTools/>}{panel==='create'&&<CreateBooking initial={initialAmount?{total:initialAmount,members:invoiceShares?.length??2,invoiceShares}:undefined} onCreated={openRoom} onCancel={()=>setPanel(null)}/>} {panel==='templates'&&<Templates onCreated={openRoom}/>} {panel==='invoice'&&<InvoiceImport onAmount={(value,shares)=>{setInitialAmount(value);setInvoiceShares(shares);setPanel('create');}}/>} {panel==='notifications'&&<NotificationSettings/>} {panel==='support'&&room&&<Support room={room}/>} {panel==='review'&&room&&session?.atomicAccount&&(room.quote||room.status==='locked'||room.status==='publishing')&&config?.privyAvailable&&((reviewKind==='payment'||reviewKind==='refund')?room.members.find(m=>m.userId===session.user?.id)?.accountAddress:room.merchantId===session.user?.id?room.merchantAccountAddress:room.members.find(m=>m.userId===session.user?.id)?.accountAddress)?.toLowerCase()===session.atomicAccount.accountAddress.toLowerCase()?<Suspense fallback={<p>Preparing combined payment…</p>}>{config?.capabilities?.sponsoring?<SponsoredCompactCheckout room={room} kind={reviewKind??(room.status==='locked'||room.status==='publishing'?'publish':room.merchantId===session.user?.id?'merchant-payout':'payment')} onFinalized={()=>void load()}/>:<CompactBookingCheckout room={room} kind={reviewKind??(room.status==='locked'||room.status==='publishing'?'publish':room.merchantId===session.user?.id?'merchant-payout':'payment')} onFinalized={()=>void load()}/> }</Suspense>:panel==='review'&&room&&flowFactory&&<ConfiguredFlow room={room} kind={reviewKind??(room.status==='locked'?'publish':room.merchantId===session?.user?.id?'merchant-payout':'payment')} factory={flowFactory} onVerifiedFailure={()=>onPaymentFailed?.(room)} onFinalized={()=>{if(room.merchantId!==session?.user?.id)onPaymentFinalized?.(room);void load();}}/>} {panel==='review'&&room&&!flowFactory&&!(session?.atomicAccount&&room.quote&&((reviewKind==='payment'||reviewKind==='refund')?room.members.find(m=>m.userId===session.user?.id)?.accountAddress:room.merchantId===session.user?.id?room.merchantAccountAddress:room.members.find(m=>m.userId===session.user?.id)?.accountAddress)?.toLowerCase()===session.atomicAccount.accountAddress.toLowerCase())&&<div className="pp-form"><div className="pp-note"><Wallet size={20}/>The Google wallet signing provider and V3 write path are not verified for this deployment. A review cannot submit a transaction.</div><dl className="pp-review"><dt>Booking amount</dt><dd>{formatAmount(room.members.find(m=>m.userId===session?.user?.id)?.share??room.total)} demo dUSD</dd><dt>Terms revision</dt><dd>{room.revision}</dd><dt>Network fee · tPOT</dt><dd>Unknown — requires live estimate</dd><dt>Storage · tPOT</dt><dd>Unknown — requires live estimate</dd><dt>Wallet account</dt><dd>{session?.binding?.accountAddress??'Awaiting canonical wallet'}</dd></dl><p>Google sign-in is not payment permission. Batch payments and sponsored fees stay disabled until independently verified on Portaldot V3.</p><button className="pp-primary" disabled>Wallet authorization unavailable</button><a className="pp-secondary" href="/native">Open existing wallet checkout<ArrowUpRight size={16}/></a><p className="pp-muted">Existing wallet orders use their original account and agreement. They are not migrated to your Google account.</p></div>}</Sheet></div>;



}
