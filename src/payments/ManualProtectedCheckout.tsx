import {useEffect,useMemo,useRef,useState} from 'react';
import {useWallets} from '@privy-io/react-auth';
import {formatUnits,parseUnits,type Address,type Hex} from 'viem';
import {useAccount} from '../account/AccountProvider';
import {api} from '../commerce/api';
import type {Room} from '../commerce/types';
import {ConfiguredFlow,type CommerceFlowFactory} from '../commerce/ConfiguredFlow';
import {connectNativeWallet,createNativeAdapter,pending,type NativeAdapter,type NativeAccount,type PreparedNativeTx} from '../native/adapter';
import type {FlowKind,FlowState} from '../flows/types';
import {createCompactFlow} from './compact-flow';
import type {CompactPlan} from './compact-plan';

type Plan=CompactPlan&{owner:Address;nonce:string;relayer:Address;payerNative:string};
type Saved={account:string;nativeId:string;kind:FlowKind;quoteId:string;revision:number;txHash?:Hex;blockHash?:Hex;blockNumber?:string};

/** The fee payer signs in their own extension. No operator key or automatic spending. */
export default function ManualProtectedCheckout({room,kind,canReview=true,onFinalized,onBusyChange}:{room:Room;kind:Exclude<FlowKind,'approval'>;canReview?:boolean;onFinalized:()=>void;onBusyChange?:(busy:boolean)=>void}){
 const {session}=useAccount(),{wallets}=useWallets(),registration=session?.atomicAccount;
 const [accounts,setAccounts]=useState<NativeAccount[]>([]),[payer,setPayer]=useState(''),[adapter,setAdapter]=useState<NativeAdapter|null>(null),[payerH160,setPayerH160]=useState<Address|null>(null);
 const [budget,setBudget]=useState(''),[spendable,setSpendable]=useState(0n),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<PreparedNativeTx|null>(null),[generation,setGeneration]=useState(0);
 const storageKey='pactpay:manual-v2:'+room.id+':'+registration?.accountAddress;
 const [interrupted,setInterrupted]=useState(()=>!!localStorage.getItem(storageKey));
 const answer=useRef<((accepted:boolean)=>void)|null>(null),alive=useRef(true),running=useRef(false);
 const candidate=wallets.find(w=>w.walletClientType==='privy'&&w.type==='ethereum'&&w.address.toLowerCase()===registration?.ownerAddress.toLowerCase());
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;answer.current?.(false);};},[]);
 useEffect(()=>()=>{void adapter?.disconnect();},[adapter]);
 async function run(action:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);onBusyChange?.(true);setError('');try{await action();}catch(e){if(alive.current)setError((e as Error).message);}finally{running.current=false;if(alive.current){setBusy(false);onBusyChange?.(false);}}}
 async function choose(native:string,a:NativeAdapter){const account=await a.account(native);if(!account.mapped)throw Error('Use a native wallet with a verified Portaldot mapping.');setPayer(native);setPayerH160(account.h160);setSpendable(account.spendable);setBudget(formatUnits(account.spendable<4000000000000000n?account.spendable:4000000000000000n,14));setGeneration(v=>v+1);}
 async function attach(value:Saved,a:NativeAdapter){
  if(!value.txHash||!value.blockHash||!registration||value.account.toLowerCase()!==registration.accountAddress.toLowerCase())throw Error('The saved execution belongs to a different account.');
  const blockNumber=value.blockNumber??await a.finalizedBlockNumber(value.blockHash);
  if(value.kind==='publish')await api('/rooms/'+room.id+'/protected-booking','POST',{quoteId:value.quoteId,revision:value.revision,txHash:value.txHash,blockNumber});
  else if(value.kind!=='cancel')await api('/rooms/'+room.id+'/protected-events','POST',{txHash:value.txHash,blockNumber});
  const savedPending=pending(localStorage);
  if(savedPending?.id===value.nativeId)a.acknowledge(localStorage,{hash:value.txHash,blockHash:value.blockHash});
  localStorage.removeItem(storageKey);setInterrupted(false);onFinalized();
 }
 const factory=useMemo<CommerceFlowFactory|undefined>(()=>{
  if(!adapter||!payer||!payerH160||!registration||!candidate||interrupted||!canReview)return;
  let total:bigint;try{total=parseUnits(budget,14);}catch{return;}
  if(total<=0n||total>spendable)return;
  const feeCap=total<20000000000000n?total:20000000000000n,storageCap=total-feeCap;
  return ()=>{
   const expiresAt=Date.now()+600000;let latest:Plan|undefined,receipt:Saved|undefined;
   return {authorizationCount:2,port:createCompactFlow({account:registration.accountAddress as Address,owner:registration.ownerAddress as Address,chainId:420420777,feePayer:{native:payer,h160:payerH160},adapter,
    readNonce:()=>adapter.readContractStorage(registration.accountAddress as Address,('0x'+'00'.repeat(32)) as Hex),
    signer:{identity:async()=>{const provider=await candidate.getEthereumProvider();const [addresses,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);if(!addresses.some((address:string)=>address.toLowerCase()===registration.ownerAddress.toLowerCase()))throw Error('Restore the Google wallet that owns this payment account.');if(Number(chain)!==420420777)await candidate.switchChain(420420777);return {account:registration.ownerAddress as Address,chainId:Number(await provider.request({method:'eth_chainId'}))};},signTypedData:async typed=>(await candidate.getEthereumProvider()).request({method:'eth_signTypedData_v4',params:[registration.ownerAddress,JSON.stringify(typed,(_,v)=>typeof v==='bigint'?String(v):v)]}) as Promise<Hex>},
    plan:async()=>{const plan=await api<Plan>('/rooms/'+room.id+'/protected-fee-plan','POST',{kind,payerNative:payer,expiresAt});if(plan.owner.toLowerCase()!==registration.ownerAddress.toLowerCase()||plan.relayer.toLowerCase()!==payerH160.toLowerCase()||plan.binding.revision!==room.revision||plan.binding.termsHash!==room.termsHash||plan.binding.account.toLowerCase()!==registration.accountAddress.toLowerCase())throw Error('Booking, owner or fee payer changed. Review again.');latest=plan;return plan;},
    feeCap,storageCap,preliminaryEvidence:'User-selected maximum for execution and refundable storage; exact costs follow owner authorization.',expiresAt,deadline:BigInt(Math.floor(expiresAt/1000)),
    reviewFeePayer:async tx=>{setReview(tx);return new Promise<boolean>(resolve=>{answer.current=resolve;});},
    send:async tx=>{if(!latest)throw Error('Review the current booking first.');receipt={account:registration.accountAddress,nativeId:tx.id,kind,quoteId:latest.binding.quoteId,revision:room.revision};localStorage.setItem(storageKey,JSON.stringify(receipt));try{const result=await adapter.signAndSend(tx,localStorage);receipt={...receipt,txHash:result.hash,blockHash:result.blockHash};localStorage.setItem(storageKey,JSON.stringify(receipt));return result.hash;}catch(e){if(typeof e==='object'&&e!==null&&'code' in e&&e.code===4001){localStorage.removeItem(storageKey);setInterrupted(false);}else setInterrupted(true);throw e;}},
    confirm:async hash=>receipt?.txHash===hash?'finalized':'unknown',
    receipt:async()=>{if(!receipt)throw Error('Recover the saved execution before continuing.');await attach(receipt,adapter);},
    persist:async (_state:FlowState)=>{},
   })};
  };
 },[adapter,payer,payerH160,registration?.accountAddress,registration?.ownerAddress,candidate,interrupted,canReview,budget,spendable,room.id,room.revision,room.termsHash,kind,generation]);
 return <section className="pp-form" aria-label="Payment with your chosen fee payer"><h3>Choose who pays the network fees</h3>
  <p>Your Google wallet approves the booking action. The Polkadot.js wallet you choose pays gas and any refundable storage deposit, after a separate cost review.</p>
  {!adapter?<button className="pp-secondary" disabled={busy} onClick={()=>void run(async()=>{const list=await connectNativeWallet();if(!list.length)throw Error('Share a fee payer account in Polkadot.js.');const a=await createNativeAdapter();try{await choose(list[0].address,a);setAccounts(list);setAdapter(a);}catch(e){await a.disconnect();throw e;}})}>Connect fee-paying wallet</button>:<>
   <label>Fee-paying wallet<select value={payer} disabled={busy} onChange={e=>void run(()=>choose(e.target.value,adapter))}>{accounts.map(account=><option key={account.address} value={account.address}>{account.name} · {account.address}</option>)}</select></label>
   <p>Available for fees and deposits: {formatUnits(spendable,14)} tPOT.</p>
   <label>Maximum total cost · tPOT<input type="number" min="0" step="any" value={budget} disabled={busy} onChange={e=>setBudget(e.target.value)}/></label>
   <p>This is a ceiling, not a charge. Review the exact fee and storage deposit before confirming in Polkadot.js. No new contract is deployed.</p>
  </>}
  {interrupted&&<><p>A previous execution needs checking. A second payment will not be sent.</p><button className="pp-secondary" disabled={busy||!adapter} onClick={()=>void run(async()=>{const value=JSON.parse(localStorage.getItem(storageKey)??'null') as Saved|null;if(!value||!adapter)throw Error('Saved execution details are missing.');if(value.txHash&&value.blockHash){await attach(value,adapter);return;}if(pending(localStorage)?.id!==value.nativeId)throw Error('Check the fee wallet activity for this booking before trying again.');const recovered=await adapter.recover(localStorage);const saved={...value,txHash:recovered.hash,blockHash:recovered.blockHash};localStorage.setItem(storageKey,JSON.stringify(saved));await attach(saved,adapter);})}>Recover previous execution</button></>}
  {factory&&<ConfiguredFlow key={kind+':'+generation} room={room} kind={kind} factory={factory} onBusyChange={value=>{setBusy(value);onBusyChange?.(value);}} onFinalized={onFinalized}/>}
  {!canReview&&!interrupted&&<p>No payment action is due. Follow the booking status above.</p>}
  {review&&<section className="pp-message"><h3>Confirm the exact network cost</h3><p>Gas: {formatUnits(review.fee,14)} tPOT<br/>Refundable storage deposit: {formatUnits(review.storageDeposit,14)} tPOT</p><button className="pp-primary" onClick={()=>{setReview(null);answer.current?.(true);answer.current=null;}}>Confirm costs in Polkadot.js</button><button className="pp-text" onClick={()=>{setReview(null);answer.current?.(false);answer.current=null;}}>Back</button></section>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
