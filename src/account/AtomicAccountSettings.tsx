import {useEffect,useRef,useState} from 'react';
import {isAddress} from 'viem';
import {api} from '../commerce/api';
import {useAccount} from './AccountProvider';

export type AtomicRegistration={accountAddress:string;ownerAddress:string;chainId:number;active:boolean;verifiedAt:string;blockHash?:string};
type Status={account:AtomicRegistration|null;relayAvailable:boolean};
const DEMO_OWNER='0x9c45230c3aa792798ae3e9f74ecdcfd096eddd53';
const DEMO_ACCOUNT='0xbbb5bf2d025b7e2853cd0e78c2d408b115470f12';
export function AtomicAccountSettings(){
 const {session,refresh}=useAccount();const [status,setStatus]=useState<Status|null>(null),[address,setAddress]=useState(()=>session?.binding?.ownerAddress?.toLowerCase()===DEMO_OWNER?DEMO_ACCOUNT:''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');const pending=useRef(false);const identity=session?.binding?.ownerAddress;
 useEffect(()=>{let current=true;setStatus(null);setError('');setAddress(identity?.toLowerCase()===DEMO_OWNER?DEMO_ACCOUNT:'');api<Status>('/account/atomic').then(value=>{if(current)setStatus({...value,account:value.account??null});}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[identity]);
 async function update(path:string,body:unknown){if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');try{await api(path,'POST',body);const value=await api<Status>('/account/atomic');setStatus(value);await refresh();setMessage('Account linked. No payment was sent.');}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}
 return <section id="pd-payment-account" aria-label="Payment account"><h3>Payment account</h3>{!status&&!error&&<p role="status">Checking…</p>}{status?.account?<><p style={{overflowWrap:'anywhere'}}>{status.account.accountAddress}</p><p>{status.relayAvailable?'Combined payments are available with a fee-paying wallet selected at checkout.':'Connect your existing wallet to continue.'}</p><label className="pp-check"><input type="checkbox" checked={status.account.active} disabled={busy||(!status.relayAvailable&&!status.account.active)} onChange={e=>void update('/account/atomic/activate',{enabled:e.target.checked})}/>Use for new bookings</label><p>Existing bookings keep their current wallet.</p></>:status&&<><p>Bookings use your current wallet. Link another payment account only if you already have one.</p><div className="pd-link-account"><label>Account address<input value={address} disabled={busy} placeholder="0x…" onChange={e=>setAddress(e.target.value.trim())}/></label><button type="button" className="pp-secondary" disabled={busy||!isAddress(address)} onClick={()=>void update('/account/atomic',{accountAddress:address})}>{busy?'Checking…':'Link account'}</button></div></>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
