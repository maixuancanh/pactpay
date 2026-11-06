import {AtomicAccountSettings} from './AtomicAccountSettings';
import {useEffect,useState,lazy,Suspense} from 'react';

import {formatUnits,parseUnits} from 'viem';

import {api} from '../commerce/api';

import {useAccount} from './AccountProvider';
import {AttemptRecovery,type SyncedAttempt} from './AttemptRecovery';

const OwnerAuthorizationTool=lazy(()=>import('../payments/OwnerAuthorizationTool'));
type Budget={id:string;cap:string;reserved:string;spent:string;remaining:string;enabled:boolean;liveAvailable:boolean};

type Attempt=SyncedAttempt;
type RelayActivity={id:string;room_id:string;kind:string;status:string;settlement_pending:boolean;tx_hash?:string};

export function AccountTools({presentation='sheet'}:{presentation?:'sheet'|'page'}={}){

 const {refresh,config}=useAccount();const [relayActivity,setRelayActivity]=useState<RelayActivity[]>([]),[budgets,setBudgets]=useState<Budget[]>([]),[attempts,setAttempts]=useState<Attempt[]>([]),[cap,setCap]=useState(''),[enableNew,setEnableNew]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);

 async function load(){const [b,s]=await Promise.all([api<{budgets:Budget[]}>('/sponsorship/budgets'),api<{attempts:Attempt[];relayIntents?:RelayActivity[]}>('/sync')]);setBudgets(b.budgets);setAttempts(s.attempts??[]);setRelayActivity(s.relayIntents??[]);}

 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[]);

 async function save(id:string|null,body:unknown){if(busy)return;setBusy(true);try{await api('/sponsorship/budgets'+(id?'/'+encodeURIComponent(id):''),id?'PATCH':'POST',body);await load();setMessage('Budget policy saved. No tokens were sent or deposited.');setCap('');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}

 if(presentation==='page'&&new URLSearchParams(window.location.search).get('payment-tools')==='1')return <div className="pp-form pd-profile-tools"><section><h3>Payment tools</h3><a className="pp-text" href="/booking/profile">Back to profile</a>{config?.privyAvailable&&<Suspense fallback={<p>Loading…</p>}><OwnerAuthorizationTool/></Suspense>}<a className="pp-secondary" href="/account-executor">Check execution</a></section></div>;
 return <div className={presentation==='page'?'pp-form pd-profile-tools pd-profile-simple-settings':'pp-form'}>
  <section id="pd-recovery"><div className="pd-settings-heading"><h3>Payment activity</h3><button className="pp-secondary" type="button" disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>Refresh</button></div>{attempts.length===0?<p>No payments need your attention.</p>:attempts.map(a=><AttemptRecovery key={a.id} attempt={a} onReconciled={load}/>)}</section>
  <section id="pd-privacy"><h3>Profile privacy</h3><p>Remove your name and notification preferences. Your wallet and payment records stay.</p><div className="pd-privacy-action"><label className="pp-check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Remove my profile information and sign me out.</label><button className="pp-secondary" disabled={!confirm||busy} onClick={async()=>{setBusy(true);try{await api('/account/delete-private-profile','POST',{confirmation:'DELETE_PRIVATE_PROFILE'});sessionStorage.setItem('pactpay:explicit-signout','1');window.dispatchEvent(new Event('pactpay:logout'));await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Remove information</button></div></section>
  <AtomicAccountSettings/>
  <section id="pd-fee-policies"><h3>Cover fees for your group</h3><p>{config?.capabilities?.sponsoring?'Set a spending limit for eligible booking fees.':'Fee coverage is unavailable. You can save a draft limit; it will not enable spending.'}</p><form className="pp-form" onSubmit={e=>{e.preventDefault();try{if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,14})?$/.test(cap))throw Error('Enter a valid tPOT amount.');void save(null,{cap:parseUnits(cap,14).toString(),enabled:enableNew&&!!config?.capabilities?.sponsoring});}catch(e){setMessage((e as Error).message);}}}><label>Limit · tPOT<input required inputMode="decimal" value={cap} onChange={e=>setCap(e.target.value)}/></label><label className="pp-check"><input type="checkbox" checked={enableNew} disabled={busy||!config?.capabilities?.sponsoring} onChange={e=>setEnableNew(e.target.checked)}/>Allow fees up to this limit</label><button className="pp-secondary" disabled={busy}>{config?.capabilities?.sponsoring?'Save limit':'Save draft limit'}</button></form>{budgets.map(b=><article key={b.id} className="pp-note"><p>Limit {formatUnits(BigInt(b.cap),14)} · Pending {formatUnits(BigInt(b.reserved),14)} · Used {formatUnits(BigInt(b.spent),14)} · Remaining {formatUnits(BigInt(b.remaining),14)} tPOT</p><p>{b.enabled?'Enabled':'Paused'}{!b.liveAvailable?' · Currently unavailable':''}</p>{!b.enabled&&b.liveAvailable&&<button type="button" className="pp-secondary" disabled={busy||BigInt(b.remaining)<=0n} onClick={()=>void save(b.id,{cap:b.cap,enabled:true})}>Enable fee coverage</button>}{b.enabled&&<button type="button" className="pp-secondary" disabled={busy} onClick={()=>void save(b.id,{cap:b.cap,enabled:false})}>Pause fee coverage</button>}</article>)}{relayActivity.length>0&&<><h4>Covered payments</h4>{relayActivity.map(a=><article key={a.id}><a href={'/booking?room='+encodeURIComponent(a.room_id)}>{a.kind} · {a.status}</a>{a.settlement_pending&&<p>Fee total updating.</p>}</article>)}</>}</section>
  <section className="pd-settings-links"><h3>Payment tools</h3><a href="/booking/profile?payment-tools=1">Review a payment request</a><a href="/account-executor">Check execution</a></section>
  {message&&<p role="status">{message}</p>}
 </div>;
}
