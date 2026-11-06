import {useEffect,useMemo,useRef,useState} from 'react';

import {useWallets} from '@privy-io/react-auth';

import {formatUnits,type Address,type Hex} from 'viem';

import {useAccount} from '../account/AccountProvider';

import {api} from '../commerce/api';

import type {Room} from '../commerce/types';

import {ConfiguredFlow,type CommerceFlowFactory} from '../commerce/ConfiguredFlow';

import {createNativeAdapter,connectNativeWallet,pending,type NativeAdapter,type NativeAccount,type PreparedNativeTx} from '../native/adapter';

import {createCompactFlow} from './compact-flow';

import {readCompactRoomPlan,readCompactPublishPlan} from './compact-room-plan';

import type {FlowKind} from '../flows/types';

/** Manual merchant payer integration. No server key, silent sponsorship or account migration. */

export default function CompactBookingCheckout({room,kind,onFinalized}:{room:Room;kind:FlowKind;onFinalized:()=>void}){

 const {session}=useAccount(),{wallets}=useWallets();const [accounts,setAccounts]=useState<NativeAccount[]>([]),[payerH160,setPayerH160]=useState<Address|null>(null),[selected,setSelected]=useState(''),[adapter,setAdapter]=useState<NativeAdapter|null>(null),[error,setError]=useState(''),[connecting,setConnecting]=useState(false),[review,setReview]=useState<PreparedNativeTx|null>(null),[busy,setBusy]=useState(false);

 const [interrupted,setInterrupted]=useState(()=>{try{const v=JSON.parse(localStorage.getItem('pactpay:compact-attempt:'+room.id)??'null');return !!(v&&(v.submissionUncertain||v.transactionHash)&&!v.finalized);}catch{return true;}});
 const payerAnswer=useRef<((answer:boolean)=>void)|null>(null),alive=useRef(true);const atomic=session?.atomicAccount;

 useEffect(()=>{alive.current=true;return()=>{alive.current=false;payerAnswer.current?.(false);};},[]);

 useEffect(()=>()=>{void adapter?.disconnect();},[adapter]);

 async function connect(){if(connecting)return;setConnecting(true);setError('');try{const list=await connectNativeWallet();if(!list.length)throw Error('Share a fee payer account in Polkadot.js');const a=await createNativeAdapter();if(!alive.current){await a.disconnect();return;}const payer=await a.account(list[0].address);if(!payer.mapped){await a.disconnect();throw Error('Native fee payer mapping is unavailable');}setPayerH160(payer.h160);setAdapter(a);setAccounts(list);setSelected(list[0].address);}catch(e){setError((e as Error).message);}finally{if(alive.current)setConnecting(false);}}

 const candidate=wallets.find(w=>w.walletClientType==='privy'&&w.address.toLowerCase()===atomic?.ownerAddress.toLowerCase());

 const factory=useMemo<CommerceFlowFactory|undefined>(()=>{

  if(interrupted||!adapter||!selected||!payerH160||!candidate||!atomic||!['publish','payment','merchant-payout','refund'].includes(kind))return;

  return ()=>{const expiresAt=Date.now()+120000;let receipt:{hash:Hex;blockHash:Hex}|undefined;let publishIntent:string|undefined;

   return {authorizationCount:1,port:createCompactFlow({account:atomic.accountAddress as Address,owner:atomic.ownerAddress as Address,chainId:420420777,feePayer:{native:selected,h160:payerH160},adapter,

    readNonce:()=>adapter.readContractStorage(atomic.accountAddress as Address,('0x'+'00'.repeat(32)) as Hex),

    signer:{identity:async()=>{const provider=await candidate.getEthereumProvider();const [addresses,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);if(!addresses.some((a:string)=>a.toLowerCase()===atomic.ownerAddress.toLowerCase()))throw Error('Google signing wallet changed');return {account:atomic.ownerAddress as Address,chainId:Number(chain)};},signTypedData:async typed=>(await candidate.getEthereumProvider()).request({method:'eth_signTypedData_v4',params:[atomic.ownerAddress,JSON.stringify(typed,(_,v)=>typeof v==='bigint'?String(v):v)]}) as Promise<Hex>},

    plan:async()=>{const fresh=(await api<{room:Room}>('/rooms/'+encodeURIComponent(room.id))).room;if(fresh.revision!==room.revision||fresh.termsHash!==room.termsHash)throw Error('Booking changed. Review again.');if(kind==='publish')return readCompactPublishPlan({room:fresh,account:atomic.accountAddress as Address,feePayer:selected,adapter,escrow:'0x7c6b401e925d36305e96c3f5472d2bad67a6cc65',expiresAt});return readCompactRoomPlan({room:fresh,account:atomic.accountAddress as Address,feePayer:selected,action:kind as 'payment'|'merchant-payout'|'refund',adapter,expiresAt});},feeCap:10000000000000n,storageCap:500000000000000n,preliminaryEvidence:'Finite preliminary budgets; exact complete execution simulated after owner signature',expiresAt,deadline:BigInt(Math.floor(expiresAt/1000)),

    reviewFeePayer:async tx=>{setReview(tx);return new Promise<boolean>(resolve=>{payerAnswer.current=resolve;});},

    send:async tx=>{const result=await adapter.signAndSend(tx,localStorage);receipt=result;if(publishIntent)await api('/rooms/'+encodeURIComponent(room.id)+'/publish-intents/'+encodeURIComponent(publishIntent)+'/submitted','POST',{txHash:result.hash});return result.hash;},

    confirm:async hash=>{if(receipt?.hash===hash)return 'finalized';const saved=pending(localStorage);if(!saved)return 'unknown';try{const recovered=await adapter.recover(localStorage);if(recovered.hash!==hash)return 'unknown';receipt=recovered;return 'finalized';}catch{return 'unknown';}},

    receipt:async()=>{if(receipt)adapter.acknowledge(localStorage,receipt);localStorage.removeItem('pactpay:compact-attempt:'+room.id);await api('/sync');},

    persist:async state=>{localStorage.setItem('pactpay:compact-attempt:'+room.id,JSON.stringify(state));if(kind==='publish'){if(!publishIntent){const v=await api<{intent:{id:string}}>('/rooms/'+encodeURIComponent(room.id)+'/publish-intents','POST',{revision:room.revision,idempotencyKey:'room:'+room.id+':'+room.revision,escrow:state.binding.escrow,quoteId:state.binding.quoteId,chainId:420420777});publishIntent=v.intent.id;}}else await api('/rooms/'+encodeURIComponent(room.id)+'/payment-attempts','POST',{kind,binding:state.binding,attemptId:state.attemptId,transactionHash:state.transactionHash,submissionUncertain:state.submissionUncertain});}

   })};};

 },[interrupted,adapter,selected,payerH160,candidate,atomic?.accountAddress,atomic?.ownerAddress,room.id,room.revision,room.termsHash,kind]);

 return <section className="pp-form"><h3>Combined payment</h3><p>Your Google wallet approves the exact payment once. The named fee payer separately confirms network fees in Polkadot.js. Automated sponsorship is not active.</p>{!adapter?<button type="button" className="pp-secondary" disabled={connecting||busy} onClick={()=>void connect()}>{connecting?'Connecting fee payer…':'Connect payment fee payer'}</button>:<label>Network fee payer<select disabled={true} value={selected} onChange={e=>setSelected(e.target.value)}>{accounts.map(a=><option key={a.address} value={a.address}>{a.name} · {a.address}</option>)}</select></label>}{interrupted&&<div className="pp-note"><p>A previous execution needs checking. No payment will be resent.</p><button type="button" className="pp-secondary" disabled={!adapter||busy} onClick={async()=>{if(!adapter)return;setBusy(true);setError('');try{const result=await adapter.recover(localStorage);adapter.acknowledge(localStorage,result);localStorage.removeItem('pactpay:compact-attempt:'+room.id);setInterrupted(false);onFinalized();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Check previous execution</button><p>If no transaction was found, the saved attempt stays blocked for explicit reconciliation.</p></div>}{factory&&<ConfiguredFlow onBusyChange={setBusy} room={room} kind={kind} factory={factory} onFinalized={onFinalized}/>} {review&&<section aria-label="Exact network cost review"><h3>Fee payer confirmation</h3><p>Execution fee: {formatUnits(review.fee,14)} tPOT</p><p>Storage deposit: {formatUnits(review.storageDeposit,14)} tPOT</p><p>Separate native wallet confirmation is required. No new contract is deployed.</p><button type="button" className="pp-primary" onClick={()=>{setReview(null);payerAnswer.current?.(true);payerAnswer.current=null;}}>Confirm these costs in Polkadot.js</button><button type="button" className="pp-secondary" onClick={()=>{setReview(null);payerAnswer.current?.(false);payerAnswer.current=null;}}>Keep payment unsigned by fee payer</button></section>}{error&&<p role="alert">{error}</p>}</section>;

}
