import {useEffect,useRef,useState} from 'react';
import {formatUnits,isAddress,type Address,type Hex} from 'viem';
import {connectNativeWallet,createNativeAdapter,pending,type NativeAdapter,type NativeAccount,type PreparedNativeTx} from '../native/adapter';
import {prepareCompactExecution} from './compact-account';
import type {AccountCall} from './pact-account';
import {REQUEST_KEY,REQUEST_CHANNEL,validCompactRequest} from './compact-request-handoff';
const ACCOUNT='0xbbb5bf2d025b7e2853cd0e78c2d408b115470f12';
const OWNER='0x9c45230c3aa792798ae3e9f74ecdcfd096eddd53';
export default function AccountExecutorPage(){
 const [accounts,setAccounts]=useState<NativeAccount[]>([]),[selected,setSelected]=useState(''),[raw,setRaw]=useState(()=>sessionStorage.getItem(REQUEST_KEY)??''),[prepared,setPrepared]=useState<PreparedNativeTx|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const adapter=useRef<NativeAdapter|null>(null);const running=useRef(false);
 async function get(){return adapter.current??(adapter.current=await createNativeAdapter());}
 async function run(fn:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage((e as Error).message);}finally{running.current=false;setBusy(false);}}
 useEffect(()=>{if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel(REQUEST_CHANNEL);channel.onmessage=e=>{if(e.data?.type==='signed-request'&&typeof e.data.raw==='string'&&validCompactRequest(e.data.raw)){sessionStorage.setItem(REQUEST_KEY,e.data.raw);setRaw(e.data.raw);setPrepared(null);setMessage('Signed request received. Ready for simulation; no transaction sent.');}};channel.postMessage({type:'request'});return()=>channel.close();},[]);
 useEffect(()=>()=>{void adapter.current?.disconnect();},[]);
 return <main className="setup-page"><a href="/booking">PactPay bookings</a><h1>Atomic account verification</h1>
  <section><h2>Your account is already deployed</h2><p style={{overflowWrap:'anywhere'}}>{ACCOUNT}</p><p>Owner {OWNER}</p><p>No further deployment is required. Connect the native fee payer and simulate your signed request.</p></section>
  <button disabled={busy} onClick={()=>void run(async()=>{const list=await connectNativeWallet();setAccounts(list);setSelected(list[0]?.address??'');setPrepared(null);})}>Connect native fee payer</button>
  {accounts.length>0&&<label>Execution fee payer<select value={selected} onChange={e=>{setSelected(e.target.value);setPrepared(null);}}>{accounts.map(a=><option key={a.address} value={a.address}>{a.name} · {a.address}</option>)}</select></label>}
  <section><h2>Simulate the owner-approved request</h2><p>The Google owner authorizes exact calls. Simulation reads network state without sending a transaction.</p>
   {!validCompactRequest(raw)&&<p role="status">No current signed request is available. In booking, choose your account → Atomic account setup → Prepare zero-payment verification → Sign this exact request. Return using Continue to execution simulation. Do not deploy again.</p>}
   <details><summary>Signed request details or manual paste</summary><label>Signed authorization JSON<textarea rows={6} value={raw} onChange={e=>{setRaw(e.target.value);setPrepared(null);}}/></label></details>
   <button disabled={busy||!selected||!validCompactRequest(raw)} onClick={()=>void run(async()=>{
    setPrepared(null);if(!validCompactRequest(raw))throw Error('Create a fresh signed request in booking');
    const r=JSON.parse(raw) as {version:string;account:Address;owner:Address;chainId:number;calls:AccountCall[];nonce:string;deadline:string;signature:Hex;maxFee:string;maxStorage:string};
    if(r.account.toLowerCase()!==ACCOUNT||r.owner.toLowerCase()!==OWNER||!isAddress(r.account)||!/^\d+$/.test(r.nonce)||!/^\d+$/.test(r.maxFee)||!/^\d+$/.test(r.maxStorage))throw Error('Request identity or finite limits differ');
    const a=await get(),payer=await a.account(selected);let tx:PreparedNativeTx;try{tx=await prepareCompactExecution({adapter:a,sponsorNative:selected,sponsorH160:payer.h160,account:r.account,owner:r.owner,chainId:r.chainId,calls:r.calls,nonce:BigInt(r.nonce),deadline:BigInt(r.deadline),signature:r.signature,maxFee:BigInt(r.maxFee),maxStorage:BigInt(r.maxStorage)});}catch(e){throw Error((e as Error).message+' Available native funds: '+formatUnits(payer.spendable,14)+' tPOT. No execution was broadcast.');}setPrepared(tx);
   })}>Simulate complete atomic execution</button>
   {prepared&&<section><h3>Execution review</h3><p>Fee {formatUnits(prepared.fee,14)} tPOT · storage {formatUnits(prepared.storageDeposit,14)} tPOT.</p><p>This is a new execution cost, separate from the completed account deployment.</p><button disabled={busy||prepared.address!==selected} onClick={()=>void run(async()=>{if(!validCompactRequest(raw)||prepared.address!==selected)throw Error('Request expired or payer changed');const a=await get();const result=await a.signAndSend(prepared,localStorage);setMessage('Finalized atomic execution '+result.hash);a.acknowledge(localStorage,result);setPrepared(null);sessionStorage.removeItem(REQUEST_KEY);setRaw('');})}>Confirm sponsored execution in Polkadot.js</button></section>}
  </section>
  {selected&&pending(localStorage)&&<button disabled={busy} onClick={()=>void run(async()=>{const a=await get(),result=await a.recover(localStorage);setMessage('Recovered finalized transaction '+result.hash);a.acknowledge(localStorage,result);})}>Check pending transaction</button>}
  {message&&<p role="status" style={{overflowWrap:'anywhere'}}>{message}</p>}
 </main>;
}
