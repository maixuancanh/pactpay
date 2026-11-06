import {useRef,useState} from 'react';
import {decodeFunctionResult,encodeFunctionData,formatUnits,parseAbi,type Address,type Hex} from 'viem';
import {connectNativeWallet,createNativeAdapter,type PreparedNativeTx} from '../native/adapter';
import {createProtectedReader,protectedAbi,type ProtectedDeployment} from './protected-adapter';
import {protectedNextAction,type ProtectedActionSnapshot} from './protected-action';

const tokenAbi=parseAbi(['function allowance(address,address) view returns (uint256)','function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)']);

export default function ProtectedNativeContribution({deployment,quote,member}:{deployment:ProtectedDeployment;quote:Hex;member:Address}){
 const adapter=useRef<Awaited<ReturnType<typeof createNativeAdapter>>|null>(null);
 const running=useRef(false);
 const [address,setAddress]=useState('');
 const [merchantAddress,setMerchantAddress]=useState('');
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

 async function prepare(){
  const native=adapter.current??=await createNativeAdapter();
  const snapshot=await createProtectedReader(deployment).read(quote,member);
  const booking=snapshot.booking as {state:number;fundingDeadline:bigint};
  const [share,paid]=snapshot.position as readonly [bigint,bigint];
  if(Number(booking.state)!==1||snapshot.timestamp>=booking.fundingDeadline||share<=0n||paid!==0n)throw Error('This booking is not open for this buyer to contribute.');
  const actor=await native.account(address);
  if(!actor.mapped||actor.h160.toLowerCase()!==member.toLowerCase())throw Error('Connect the native wallet mapped to this buyer.');
  const token=decodeFunctionResult({abi:protectedAbi,functionName:'token',data:await native.readContractData(address,deployment.address,encodeFunctionData({abi:protectedAbi,functionName:'token'}))}) as Address;
  const balance=decodeFunctionResult({abi:tokenAbi,functionName:'balanceOf',data:await native.readContractData(address,token,encodeFunctionData({abi:tokenAbi,functionName:'balanceOf',args:[member]}))});
  if(balance<share)throw Error('The buyer has insufficient demo dUSD.');
  const allowance=decodeFunctionResult({abi:tokenAbi,functionName:'allowance',data:await native.readContractData(address,token,encodeFunctionData({abi:tokenAbi,functionName:'allowance',args:[member,deployment.address]}))});
  const amount=formatUnits(share,6);
  setReview(allowance<share
   ?await native.prepareCall(address,token,encodeFunctionData({abi:tokenAbi,functionName:'approve',args:[deployment.address,share]}),`Approve ${amount} dUSD for this escrow`)
   :await native.prepareCall(address,deployment.address,encodeFunctionData({abi:protectedAbi,functionName:'contribute',args:[quote]}),`Contribute ${amount} dUSD`));
 }

 async function prepareProtectedAction(action:'capture'|'settle'|'claim'|'cancel'|'refund'){
  const native=adapter.current??=await createNativeAdapter();
  const reader=createProtectedReader(deployment);
  const first=await reader.read(quote,member);
  const merchant=(first.booking as {merchant:Address}).merchant;
  const signerAccount=action==='refund'?member:merchant;
  const snapshot=await reader.read(quote,member,signerAccount);
  const booking=snapshot.booking as ProtectedActionSnapshot['booking'];
  const position=snapshot.position as ProtectedActionSnapshot['position'];
  const credit=snapshot.actorCredit as bigint;
  const next=protectedNextAction({booking,position,actor:merchant,member,timestamp:snapshot.timestamp,actorCredit:0n});
  if(action==='capture'&&next!=='capture')throw Error('Capture requires full funding before the capture deadline.');
  if(action==='cancel'&&Number(booking.state)!==1)throw Error('The merchant can cancel only while this booking is open for funding.');
  if(action==='settle'&&next!=='settle')throw Error('This share is not ready to settle. Check the complaint deadline and dispute status.');
  if(action==='claim'&&credit<=0n)throw Error('The merchant has no available credit. Settle the held share first.');
  if(action==='refund'&&(Number(booking.state)!==3||!position[4]||credit<=0n))throw Error('Cancel this booking and settle the buyer’s share before claiming the refund.');
  let selected=action==='refund'?address:merchantAddress;
  if(!selected){
   for(const wallet of await connectNativeWallet()){
    const actor=await native.account(wallet.address);
    if(actor.mapped&&actor.h160.toLowerCase()===signerAccount.toLowerCase()){selected=wallet.address;break;}
   }
  }
  if(!selected)throw Error(action==='refund'?'Share the buyer’s native wallet in Polkadot.js to continue.':'Share the merchant’s native wallet in Polkadot.js to continue.');
  const actor=await native.account(selected);
  if(!actor.mapped||actor.h160.toLowerCase()!==signerAccount.toLowerCase())throw Error('The selected native wallet does not match the required signer.');
  if(action==='refund')setAddress(selected);
  else setMerchantAddress(selected);
  const functionName=action==='refund'?'claim':action;
  const args=functionName==='claim'?[]:action==='settle'?[quote,member]:[quote];
  const data=encodeFunctionData({abi:protectedAbi,functionName,args});
  const label=action==='claim'?`Claim all ${formatUnits(credit,6)} dUSD of merchant credit on this contract`
   :action==='refund'?`Claim all ${formatUnits(credit,6)} dUSD of buyer credit on this contract`
   :action==='cancel'?'Cancel this booking so paid shares can be settled as refunds'
   :action==='settle'?`Settle this buyer’s ${formatUnits(position[1],6)} dUSD held share into claimable credit`
   :`Capture ${formatUnits(booking.total,6)} dUSD and start the complaint window`;
  setReview(await native.prepareCall(selected,deployment.address,data,label));
 }

 return <section>
  <h2>Contribute with Polkadot.js</h2>
  {!address?<button disabled={busy} onClick={()=>void run(async()=>{
   const wallets=await connectNativeWallet();
   const native=adapter.current??=await createNativeAdapter();
   for(const wallet of wallets){
    const actor=await native.account(wallet.address);
    if(actor.mapped&&actor.h160.toLowerCase()===member.toLowerCase()){setAddress(wallet.address);return;}
   }
   throw Error('The extension did not share the native account for this buyer.');
  })}>Connect buyer wallet</button>:<button disabled={busy||!!review} onClick={()=>void run(prepare)}>Review next buyer step</button>}
  <button disabled={busy||!!review} onClick={()=>void run(()=>prepareProtectedAction('capture'))}>Review merchant capture</button>
  <button disabled={busy||!!review} onClick={()=>void run(()=>prepareProtectedAction('cancel'))}>Review merchant cancellation</button>
  <button disabled={busy||!!review} onClick={()=>void run(()=>prepareProtectedAction('settle'))}>Review settlement</button>
  <button disabled={busy||!!review} onClick={()=>void run(()=>prepareProtectedAction('claim'))}>Review merchant claim</button>
  <button disabled={busy||!!review} onClick={()=>void run(()=>prepareProtectedAction('refund'))}>Review buyer refund</button>
  {review&&<div><p>{review.label}</p><p>Signer {review.address}</p><p>Storage deposit {formatUnits(review.storageDeposit,14)} tPOT. Fee budget {formatUnits(review.fee,14)} tPOT.</p>
   <button disabled={busy} onClick={()=>void run(async()=>{
    setReview(null);
    const result=await adapter.current!.signAndSend(review,localStorage);
    adapter.current!.acknowledge(localStorage,result);
    setMessage(`Finalized transaction ${result.hash}`);
   })}>Confirm in Polkadot.js</button>
   <button disabled={busy} onClick={()=>setReview(null)}>Close review</button>
  </div>}
  <button disabled={busy||!!review} onClick={()=>void run(async()=>{
   const native=adapter.current??=await createNativeAdapter();
   const result=await native.recover(localStorage);
   native.acknowledge(localStorage,result);
   setMessage(`Finalized transaction ${result.hash}`);
  })}>Check saved native transaction</button>
  {message&&<p role="status">{message}</p>}
 </section>;
}
