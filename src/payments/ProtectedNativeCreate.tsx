import {useRef,useState,type FormEvent} from 'react';
import {encodeFunctionData,formatUnits,isAddress,keccak256,parseUnits,toHex} from 'viem';
import {connectNativeWallet,createNativeAdapter,type NativeAccount,type PreparedNativeTx} from '../native/adapter';
import {protectedAbi,type ProtectedDeployment} from './protected-adapter';

export default function ProtectedNativeCreate({deployment}:{deployment:ProtectedDeployment}){
 const adapter=useRef<Awaited<ReturnType<typeof createNativeAdapter>>|null>(null);
 const running=useRef(false);
 const [accounts,setAccounts]=useState<NativeAccount[]>([]);
 const [address,setAddress]=useState('');
 const [review,setReview]=useState<PreparedNativeTx|null>(null);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);

 async function run(action:()=>Promise<void>){
  if(running.current)return;
  running.current=true;
  setBusy(true);
  setMessage('');
  try{await action();}catch(error){setMessage(error instanceof Error?error.message:String(error));}
  finally{running.current=false;setBusy(false);}
 }

 async function prepare(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  await run(async()=>{
   const member=String(form.get('member')).trim();
   if(!isAddress(member))throw Error('Enter the buyer’s mapped 0x address.');
   const terms=String(form.get('terms')).trim();
   const shareText=String(form.get('share')).trim();
   if(!/^\d+(?:\.\d{1,6})?$/.test(shareText))throw Error('Enter a share with up to six decimal places.');
   const share=parseUnits(shareText,6);
   if(!terms||share<=0n)throw Error('Enter terms and a positive share.');
   const deadline=(key:string)=>BigInt(Math.floor(Date.parse(String(form.get(key)))/1000));
   const duration=(key:string)=>BigInt(Number(form.get(key))*60);
   const data=encodeFunctionData({abi:protectedAbi,functionName:'create',args:[[member],[share],deadline('funding'),deadline('capture'),duration('window'),duration('resolution'),keccak256(toHex(terms))]});
   adapter.current??=await createNativeAdapter();
   setReview(await adapter.current.prepareCall(address,deployment.address,data,`Create Protected V2 booking for ${formatUnits(share,6)} dUSD`));
  });
 }

 return <section>
  <h2>Create a Protected V2 booking with Polkadot.js</h2>
  {accounts.length===0?<button disabled={busy} onClick={()=>void run(async()=>{
   const wallets=await connectNativeWallet();
   if(!wallets.length)throw Error('No native wallet accounts are available.');
   setAccounts(wallets);
  })}>Connect native wallet</button>:<form onSubmit={prepare}>
   <fieldset disabled={busy||!!review}>
    <label>Merchant wallet<select required value={address} onChange={e=>setAddress(e.target.value)}><option value="">Select merchant</option>{accounts.map(a=><option key={a.address} value={a.address}>{a.name} · {a.address}</option>)}</select></label>
    <label>Buyer mapped address<input name="member" required/></label>
    <label>Buyer share in demo dUSD<input name="share" required inputMode="decimal"/></label>
    <label>Terms<textarea name="terms" required/></label>
    <label>Funding deadline<input name="funding" type="datetime-local" required/></label>
    <label>Capture deadline<input name="capture" type="datetime-local" required/></label>
    <label>Complaint window in minutes<input name="window" type="number" min="1" max="525600" defaultValue="60" required/></label>
    <label>Resolution period in minutes<input name="resolution" type="number" min="1" max="525600" defaultValue="1440" required/></label>
    <button>Review native booking</button>
   </fieldset>
  </form>}
  {review&&<div><p>{review.label}</p><p>Signer {review.address}</p><p>Storage deposit {formatUnits(review.storageDeposit,14)} tPOT. Fee budget {formatUnits(review.fee,14)} tPOT.</p>
   <button disabled={busy} onClick={()=>void run(async()=>{
    const prepared=review;
    setReview(null);
    const result=await adapter.current!.signAndSend(prepared,localStorage);
    adapter.current!.acknowledge(localStorage,result);
    setMessage(`Finalized transaction ${result.hash} in block ${result.blockHash}`);
   })}>Confirm in Polkadot.js</button>
   <button disabled={busy} onClick={()=>setReview(null)}>Edit booking</button>
  </div>}
  <button disabled={busy||!!review} onClick={()=>void run(async()=>{
   adapter.current??=await createNativeAdapter();
   const result=await adapter.current.recover(localStorage);
   adapter.current.acknowledge(localStorage,result);
   setMessage(`Finalized transaction ${result.hash} in block ${result.blockHash}`);
  })}>Check saved native transaction</button>
  {message&&<p role="status">{message}</p>}
 </section>;
}
