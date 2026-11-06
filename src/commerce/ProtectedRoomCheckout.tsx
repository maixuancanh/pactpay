import {GoogleWalletVerification} from './GoogleWalletVerification';
import {ProtectedResolution,type ResolutionTerms,type SignedResolution} from './ProtectedResolution';
import {ProtectedReleaseGuide} from './ProtectedReleaseGuide';
import {protectedOutcome,type ProtectedReceiptEvent} from './protected-outcome';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
const SponsoredCompactCheckout=lazy(()=>import('../payments/SponsoredCompactCheckout'));
import type {FlowKind} from '../flows/types';
import {createPublicClient,http,encodeFunctionData,encodeAbiParameters,hashTypedData,recoverTypedDataAddress,keccak256,parseAbi,formatUnits,type Address,type Hex} from 'viem';
import {useAccount} from '../account/AccountProvider';
import {useProtectedWallet} from '../payments/ProtectedWalletBridge';
import {protectedAbi} from '../payments/protected-adapter';
import {protectedNextAction,type ProtectedActionSnapshot} from '../payments/protected-action';
import {createEoaSequence,type EoaCall} from '../payments/eoa-sequence';
import type {PublicEoaExecution} from '../payments/PrivyCommerceBridge';
import {connectNativeWallet,createNativeAdapter,pending,type PreparedNativeTx} from '../native/adapter';
import {createFlow,executeFlow,reviewFlow} from '../flows/engine';
import {FlowReview} from '../flows/FlowReview';
import {FlowProgress} from '../flows/FlowProgress';
import type {FlowBinding,FlowState,FlowPort} from '../flows/types';
import {api} from './api';
import type {Room} from './types';

type Action='publish'|'contribute'|'capture'|'cancel'|'settle'|'claim'|'dispute'|'resolve';
type Snapshot={source:string;blockNumber:string;timestamp:string;booking:Record<string,any>;positions:{account:string;position:[string,string,string,boolean,boolean];credit:string}[];merchantCredit:string;events:ProtectedReceiptEvent[];coverage:string};
type Saved={nativeId?:string;transport?:'google'|'native';approval?:boolean;action:Action;quoteId:Hex;txHash?:Hex;blockHash?:Hex;blockNumber?:string;flow?:FlowState};
const erc=parseAbi(['function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)']);
const title:Record<Action,string>={publish:'Open protected payments',contribute:'Pay my share',capture:'Capture funded booking',cancel:'Cancel booking',settle:'Settle held share',claim:'Receive available credit',dispute:'Open a complaint',resolve:'Submit agreed settlement'};
export function ProtectedRoomCheckout({room,onChange}:{room:Room;onChange:(room:Room)=>void}){
 const {session,config}=useAccount();
 const provider=useProtectedWallet();
 const deployment=config?.protectedDeployment;
 const account=(room.merchantId===session?.user?.id?room.merchantAccountAddress:room.members.find(m=>m.userId===session?.user?.id)?.accountAddress) as Address|undefined;
 const canSignResolution=!!provider&&session?.binding?.mode==='embedded-eoa'&&session.binding.accountAddress.toLowerCase()===account?.toLowerCase();
 const merchant=room.merchantId===session?.user?.id;
 const [phase,setPhase]=useState('');
 const [authorizationCount,setAuthorizationCount]=useState(1);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[nativeReview,setNativeReview]=useState<PreparedNativeTx|null>(null),[flow,setFlow]=useState<FlowState|null>(null),[wallet,setWallet]=useState<'google'|'native'|'sponsored'>(session?.binding?.mode==='native'?'native':'google'),[selected,setSelected]=useState(room.members[0]?.accountAddress??'');
 const [sponsoredKind,setSponsoredKind]=useState<Exclude<FlowKind,'approval'>|null>(null);
 const sponsoredEligible=!!config?.privyAvailable&&!!session?.atomicAccount&&session.atomicAccount.accountAddress.toLowerCase()===account?.toLowerCase();
 const native=useRef<Awaited<ReturnType<typeof createNativeAdapter>>|null>(null),port=useRef<FlowPort|null>(null),request=useRef<Saved|null>(null),running=useRef(false);
 const googleExecutionUnavailable=wallet==='google'&&!(config as typeof config&{paymentExecution?:PublicEoaExecution})?.paymentExecution;
 const key='pactpay:protected-room:'+room.id+':'+account;
 const client=()=>createPublicClient({transport:http(deployment!.rpcUrl)});
 async function load(){
  if(!room.protectedBooking)return;
  const value=await api<Snapshot>('/rooms/'+room.id+'/protected-booking');
  setSnapshot(value);
 }
 useEffect(()=>{let active=true;setSnapshot(null);setNativeReview(null);setFlow(null);setError('');request.current=null;
  try{request.current=JSON.parse(localStorage.getItem(key)||'null');}catch{}
  const tick=()=>{if(room.protectedBooking)void api<Snapshot>('/rooms/'+room.id+'/protected-booking').then(value=>{if(active){setSnapshot(value);setError('');}}).catch(e=>{if(active){setSnapshot(null);setError(e.message);}});};
  tick();const timer=setInterval(tick,15000);return()=>{active=false;clearInterval(timer);};
 },[room.id,room.protectedBooking?.quoteId,account]);
 async function run(action:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);setError('');setMessage('');setPhase('Checking the current booking and wallet...');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{running.current=false;setBusy(false);setPhase('');}}
 function save(value:Saved){request.current=value;localStorage.setItem(key,JSON.stringify(value));}
 async function record(value:Saved){
  setPhase('Verifying the finalized receipt with your booking...');
  if(value.transport==='native'&&value.blockHash&&!value.blockNumber){
   const adapter=native.current??=await createNativeAdapter();
   value={...value,blockNumber:await adapter.finalizedBlockNumber(value.blockHash)};save(value);
  }
  if(!value.txHash||!value.blockNumber)throw Error('The receipt still needs its finalized block.');
  if(value.approval){
   const adapter=native.current??=await createNativeAdapter();
   if(pending(localStorage)?.id!==value.nativeId)throw Error('Approval recovery must match the original native review.');
   const recovered=await adapter.recover(localStorage);
   if(recovered.hash!==value.txHash)throw Error('The recovered approval transaction changed.');
   adapter.acknowledge(localStorage,recovered);
   localStorage.removeItem(key);request.current=null;setMessage('Approval finalized. Choose Pay my share to contribute.');return;
  }
  if(value.action==='publish'){
   const result=await api<{room:Room}>('/rooms/'+room.id+'/protected-booking','POST',{quoteId:value.quoteId,txHash:value.txHash,blockNumber:value.blockNumber,revision:room.revision});
   onChange(result.room);
  }else if(value.action!=='cancel'){
   await api('/rooms/'+room.id+'/protected-events','POST',{txHash:value.txHash,blockNumber:value.blockNumber});
  }
  if(value.transport==='native'&&pending(localStorage)?.id===value.nativeId&&value.blockHash){
   const adapter=native.current??=await createNativeAdapter();
   adapter.acknowledge(localStorage,{hash:value.txHash,blockHash:value.blockHash});
  }
  localStorage.removeItem(key);request.current=null;setMessage('Finalized transaction '+value.txHash);setNativeReview(null);setFlow(null);await load();
 }
 async function prepare(action:Action,resolution?:SignedResolution){
  if(wallet==='sponsored')throw Error('Use the covered-fee checkout for this action.');
  if(!deployment||!account||!room.termsHash)throw Error('Lock the agreed booking with its verified wallet first.');
  if(pending(localStorage))throw Error('A native transaction is still saved. Recover it before preparing another action.');
  if(request.current?.txHash||request.current?.flow?.transactionHash||request.current?.flow?.submissionUncertain)throw Error('Check the saved transaction before starting another action.');
  const c=client(),calls:EoaCall[]=[];
  const call=(name:string,args:unknown[],label:string)=>({to:deployment.address as Address,data:encodeFunctionData({abi:protectedAbi,functionName:name,args}),label});
  let quoteId=room.protectedBooking?.quoteId as Hex|undefined;
  if(action==='publish'){
   if(!merchant||room.status!=='locked'||room.members.some(m=>m.acceptedRevision!==room.revision))throw Error('The merchant can publish only a locked booking with every share accepted.');
   const nonce=await c.readContract({address:deployment.address as Address,abi:protectedAbi,functionName:'merchantNonce',args:[account]}) as bigint;
   quoteId=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'address'},{type:'uint256'}],[BigInt(deployment.chainId),deployment.address as Address,account,nonce]));
   calls.push(call('create',[room.members.map(m=>m.accountAddress),room.members.map(m=>BigInt(m.share)),BigInt(Date.parse(room.fundingDeadline)/1000),BigInt(Date.parse(room.serviceAt)/1000),BigInt(room.complaintSeconds!),BigInt(room.resolutionSeconds!),room.termsHash],title.publish));
  }else{
   if(!quoteId)throw Error('Publish this booking before taking payment.');
   const fresh=await api<Snapshot>('/rooms/'+room.id+'/protected-booking');
   setSnapshot(fresh);
   const row=fresh.positions.find(p=>p.account.toLowerCase()===(merchant?selected:account).toLowerCase());
   if(!row)throw Error('Choose a member of this booking.');
   const b=fresh.booking;
   const booking:ProtectedActionSnapshot['booking']={...b,merchant:b.merchant,state:Number(b.state),funded:BigInt(b.funded),total:BigInt(b.total),capturedAt:BigInt(b.capturedAt),window:BigInt(b.window),resolutionPeriod:BigInt(b.resolutionPeriod),fundingDeadline:BigInt(b.fundingDeadline),captureDeadline:BigInt(b.captureDeadline)};
   const position:ProtectedActionSnapshot['position']=[BigInt(row.position[0]),BigInt(row.position[1]),BigInt(row.position[2]),row.position[3],row.position[4]];
   const credit=BigInt(merchant?fresh.merchantCredit:row.credit);
   const next=protectedNextAction({booking,position,actor:account,member:row.account,timestamp:BigInt(fresh.timestamp),actorCredit:action==='claim'?credit:0n});
   if(action==='cancel'){if(!merchant||booking.state!==1)throw Error('Only the merchant can cancel before capture.');}
   else if(action==='resolve'){
    if(!resolution||!position[3]||position[4]||booking.state!==2||resolution.refund>position[1]||resolution.deadline<=BigInt(fresh.timestamp)||resolution.deadline>=booking.capturedAt+booking.window+booking.resolutionPeriod)throw Error('This settlement proposal has expired or the disputed share changed.');
   }
   else if(next!==action)throw Error('This action is unavailable in the latest finalized state. Refresh and review the next step.');
   if(action==='contribute'){
    const token=await c.readContract({address:deployment.address as Address,abi:protectedAbi,functionName:'token'}) as Address;
    const [balance,allowance]=await Promise.all([c.readContract({address:token,abi:erc,functionName:'balanceOf',args:[account]}),c.readContract({address:token,abi:erc,functionName:'allowance',args:[account,deployment.address as Address]})]);
    if(balance<position[0])throw Error('Your wallet needs '+formatUnits(position[0],6)+' demo dUSD.');
    if(allowance<position[0])calls.push({to:token,data:encodeFunctionData({abi:erc,functionName:'approve',args:[deployment.address as Address,position[0]]}),label:'Approve my exact share'});
   }
   calls.push(call(action,action==='claim'?[]:action==='settle'?[quoteId,row.account]:action==='resolve'?[quoteId,row.account,resolution!.refund,resolution!.deadline,resolution!.buyerSignature,resolution!.merchantSignature]:[quoteId],title[action]));
  }
  const saved:Saved={transport:wallet,action,quoteId:quoteId!};
  if(wallet==='native'){
   const a=native.current??=await createNativeAdapter();
   let signer:string|undefined;
   for(const candidate of await connectNativeWallet()){const mapped=await a.account(candidate.address);if(mapped.mapped&&mapped.h160.toLowerCase()===account.toLowerCase()){signer=candidate.address;break;}}
   if(!signer)throw Error('Share the Polkadot.js wallet mapped to this booking account. Its fixed address is '+account+'.');
   // Exact approval is reviewed separately with the native wallet.
   const first=calls[0];setPhase('Estimating network fees and storage...');const prepared=await a.prepareCall(signer,first.to,first.data,first.label);setNativeReview(prepared);
   save({...saved,nativeId:prepared.id,approval:calls.length>1});
   if(calls.length>1)setMessage('First approve your exact share. Once finalized, choose Pay my share again to contribute.');
  }else{
   if(action==='resolve')await c.call({account,to:calls[0].to,data:calls[0].data});
   const execution=(config as typeof config&{paymentExecution?:PublicEoaExecution})?.paymentExecution;
   if(!provider||!execution)throw Error('Complete the Google wallet verification above, then review this booking payment.');
   const expires=Date.now()+Math.min(120000,execution.estimateTtlMs);
   const binding:FlowBinding={account,chainId:deployment.chainId,escrow:deployment.address,quoteId:quoteId!,revision:room.revision,termsHash:room.termsHash,recipient:deployment.address,amount:room.total,fee:execution.maxExecutionFee,storage:execution.maxStorageDeposit,walletCreation:execution.maxWalletCreationFee,feePayer:merchant?'merchant':'customer',estimateExpiresAt:expires};
   const sequence=createEoaSequence({rpcUrl:deployment.rpcUrl,chainId:deployment.chainId,account,capability:execution.capability,provider,feeCap:BigInt(execution.maxExecutionFee),storageCap:BigInt(execution.maxStorageDeposit),walletCreationCap:BigInt(execution.maxWalletCreationFee),denominationEvidence:execution.denominationEvidence,rpcDecimals:execution.rpcDecimals,nativeDecimals:execution.nativeDecimals,expiresAt:expires,async plan(){const current=await api<{room:Room}>('/rooms/'+room.id);if(current.room.revision!==room.revision||current.room.termsHash!==room.termsHash)throw Error('Booking changed. Review the current terms.');
    if(action==='publish'){
     if(current.room.protectedBooking)throw Error('This booking has already been published. Refresh its payment state.');
     const currentNonce=await c.readContract({address:deployment.address as Address,abi:protectedAbi,functionName:'merchantNonce',args:[account]}) as bigint;
     const currentId=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'address'},{type:'uint256'}],[BigInt(deployment.chainId),deployment.address as Address,account,currentNonce]));
     if(currentId!==quoteId)throw Error('Another booking used this nonce. Prepare a fresh publication review.');
    }
    return {binding,calls};},async persist(state){save({...saved,flow:state});setFlow(state);},async receipt(txHash){const receipt=await c.getTransactionReceipt({hash:txHash});await record({...saved,txHash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash});}});
   const reviewId=crypto.randomUUID();
   const preflight=sequence.port.preflight.bind(sequence.port);
   port.current={...sequence.port,async preflight(){const value=await preflight();return {...value,actionId:value.actionId+':'+reviewId};}};
   setAuthorizationCount(calls.length);
   const ready=await port.current.preflight();setFlow(createFlow(action==='publish'?'publish':action==='contribute'?'payment':action==='cancel'?'cancel':merchant?'merchant-payout':'refund',ready));save(saved);
  }
 }
 const row=snapshot?.positions.find(p=>p.account.toLowerCase()===(merchant?selected:account)?.toLowerCase());
 const resolutionDeadline=snapshot?BigInt(snapshot.booking.capturedAt)+BigInt(snapshot.booking.window)+BigInt(snapshot.booking.resolutionPeriod):0n;
 const canResolve=!!(row&&snapshot&&Number(snapshot.booking.state)===2&&row.position[3]&&!row.position[4]&&BigInt(snapshot.timestamp)<resolutionDeadline);
 async function signResolution(terms:ResolutionTerms):Promise<Hex>{
  if(!canSignResolution||!provider||!account||!deployment||!row||!room.protectedBooking)throw Error('Connect the fixed Ethereum wallet for this booking.');
  const fresh=await api<Snapshot>('/rooms/'+room.id+'/protected-booking');
  const position=fresh.positions.find(item=>item.account.toLowerCase()===row.account.toLowerCase())?.position;
  const ends=BigInt(fresh.booking.capturedAt)+BigInt(fresh.booking.window)+BigInt(fresh.booking.resolutionPeriod);
  if(!position?.[3]||position[4]||Number(fresh.booking.state)!==2||terms.refund>BigInt(position[1])||terms.deadline<=BigInt(fresh.timestamp)||terms.deadline>=ends)throw Error('The disputed share or signature deadline changed.');
  const typed={domain:{name:'PactPayProtected',version:'2',chainId:deployment.chainId,verifyingContract:deployment.address as Address},types:{Resolution:[{name:'bookingId',type:'bytes32'},{name:'member',type:'address'},{name:'refund',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},primaryType:'Resolution' as const,message:{bookingId:room.protectedBooking.quoteId as Hex,member:row.account as Address,refund:terms.refund,nonce:BigInt(position[2]),deadline:terms.deadline}};
  const digest=await client().readContract({address:deployment.address as Address,abi:protectedAbi,functionName:'resolutionDigest',args:[typed.message.bookingId,typed.message.member,terms.refund,typed.message.nonce,terms.deadline]});
  if(digest!==hashTypedData(typed))throw Error('The proposal does not match the contract digest.');
  const signature=await provider.request({method:'eth_signTypedData_v4',params:[account,JSON.stringify({...typed,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...typed.types}},(_,value)=>typeof value==='bigint'?value.toString():value)]}) as Hex;
  if((await recoverTypedDataAddress({...typed,signature})).toLowerCase()!==account.toLowerCase())throw Error('The signature came from a different wallet.');
  return signature;
 }
 let next:Action|null=null;
 if(snapshot&&row&&account){const b=snapshot.booking;next=protectedNextAction({booking:{...b,merchant:b.merchant,state:Number(b.state),total:BigInt(b.total),funded:BigInt(b.funded),capturedAt:BigInt(b.capturedAt),window:BigInt(b.window),resolutionPeriod:BigInt(b.resolutionPeriod),fundingDeadline:BigInt(b.fundingDeadline),captureDeadline:BigInt(b.captureDeadline)},position:[BigInt(row.position[0]),BigInt(row.position[1]),BigInt(row.position[2]),row.position[3],row.position[4]],timestamp:BigInt(snapshot.timestamp),actorCredit:BigInt(merchant?snapshot.merchantCredit:row.credit),actor:account,member:row.account}) as Action|null;}
 return <section className="pp-panel pp-protected-checkout" aria-label="Protected booking checkout">
  <h2>Protected payments</h2><p>Payments stay in escrow through the {room.complaintSeconds!/60}-minute complaint window after capture. Unresolved complaints refund the buyer after {room.resolutionSeconds!/60} {room.resolutionSeconds===60?"minute":"minutes"}.</p>
  {!room.protectedBooking?<p>{room.status==='locked'?'Your group has agreed. Review opening payments on Portaldot.':'Invite your group and lock the agreed shares to open payments.'}</p>:snapshot?<><div className="pp-message"><strong>{Number(snapshot.booking.state)===3?'Booking cancelled':Number(snapshot.booking.state)===2?'Captured · complaint policy active':'Collecting agreed shares'}</strong><p>Funded {formatUnits(BigInt(snapshot.booking.funded),6)} / {formatUnits(BigInt(snapshot.booking.total),6)} demo dUSD · finalized block {snapshot.blockNumber}</p></div>
  <ul className="pp-roster">{snapshot.positions.map(p=>{const member=room.members.find(m=>m.accountAddress.toLowerCase()===p.account.toLowerCase());return <li key={p.account}><span className="pp-member">{member?.nickname??'Member'}<small>{protectedOutcome(p.account,p.position[1],p.position[4],Number(snapshot.booking.state),snapshot.events)}</small></span><strong>{formatUnits(BigInt(p.position[1]),6)} dUSD<small>Contributed</small></strong></li>;})}</ul>
  <p>Your available credit on this contract · <strong>{formatUnits(BigInt(merchant?snapshot.merchantCredit:row?.credit??'0'),6)} dUSD</strong></p><p className="pp-muted">Credit covers all bookings on this contract. Receiving it transfers the full available balance to your fixed wallet.</p>
  {merchant&&room.members.length>1&&<label>Member to settle<select value={selected} onChange={e=>{setSelected(e.target.value);setNativeReview(null);setFlow(null);}}>{room.members.map(m=><option key={m.userId} value={m.accountAddress}>{m.nickname}</option>)}</select></label>}
  {row&&<ProtectedReleaseGuide booking={snapshot.booking as Parameters<typeof ProtectedReleaseGuide>[0]['booking']} now={BigInt(snapshot.timestamp)} disputed={row.position[3]} settled={row.position[4]}/>}
  <a href={`/receipt?${new URLSearchParams({chainId:String(room.protectedBooking.chainId),escrow:room.protectedBooking.escrow,quoteId:room.protectedBooking.quoteId})}`}>Open public payment receipt</a>
  <details><summary>Payment evidence</summary><p className="pp-muted">{snapshot.coverage}</p>{snapshot.events.map(e=><p key={e.tx_hash+e.event_name}>{e.event_name} · block {e.block_number}<br/><span style={{overflowWrap:'anywhere'}}>{e.tx_hash}</span></p>)}</details>
  </>:<p role="status">Reading finalized payments…</p>}
  <div className="pp-form">
  {wallet==='google'&&session?.binding?.mode==='embedded-eoa'&&account?.toLowerCase()===session.binding.accountAddress.toLowerCase()&&!(config as typeof config&{paymentExecution?:PublicEoaExecution})?.paymentExecution&&<GoogleWalletVerification key={account}/>}
  {(next||canResolve||room.status==="locked"||merchant&&snapshot&&Number(snapshot.booking.state)===1)&&<label>Signing wallet<select value={wallet} disabled={busy||!!nativeReview||!!flow} onChange={e=>setWallet(e.target.value as 'google'|'native'|'sponsored')}><option value="google">Google wallet</option>{sponsoredEligible&&<option value="sponsored">Merchant-covered fees</option>}<option value="native">Polkadot.js · matching booking account</option></select></label>}
  {wallet!=='sponsored'&&!nativeReview&&!flow&&<div className="pp-actions">{room.status==='locked'&&!room.protectedBooking&&merchant&&<button className="pp-primary" disabled={busy||googleExecutionUnavailable} onClick={()=>void run(()=>prepare('publish'))}>{title.publish}</button>}{next&&<button className="pp-primary" disabled={busy||googleExecutionUnavailable} onClick={()=>void run(()=>prepare(next!))}>{title[next]}</button>}{merchant&&snapshot&&Number(snapshot.booking.state)===1&&<button className="pp-secondary" disabled={busy||googleExecutionUnavailable} onClick={()=>void run(()=>prepare('cancel'))}>Cancel booking and open refunds</button>}</div>}
  {wallet!=='sponsored'&&canResolve&&row&&snapshot&&!nativeReview&&!flow&&<ProtectedResolution key={row.account+':'+row.position[2]} member={row.account as Address} isMerchant={merchant} paid={BigInt(row.position[1])} deadline={resolutionDeadline} chainTime={BigInt(snapshot.timestamp)} canSign={canSignResolution} busy={busy} onSign={signResolution} onReview={proposal=>void run(()=>prepare('resolve',proposal))}/>}
  {wallet==='sponsored'&&sponsoredEligible&&<>
   {merchant&&snapshot&&Number(snapshot.booking.state)===1&&<button className="pp-text" onClick={()=>setSponsoredKind(value=>value==='cancel'?null:'cancel')}>{sponsoredKind==='cancel'?'Return to booking payment':'Cancel booking with covered fees'}</button>}
   <Suspense fallback={<p role="status">Loading fee coverage…</p>}><SponsoredCompactCheckout room={room} canReview={sponsoredKind==='cancel'&&Number(snapshot?.booking.state)===1||!room.protectedBooking&&merchant&&room.status==='locked'||!!next&&['contribute','capture','settle','claim'].includes(next)} kind={sponsoredKind??(!room.protectedBooking?'publish':merchant?'merchant-payout':next==='contribute'?'payment':'refund')} onFinalized={()=>void run(async()=>{const result=await api<{room:Room}>('/rooms/'+room.id);onChange(result.room);await load();})}/></Suspense>
  </>}
  {nativeReview&&<div className="pp-message"><h3>{nativeReview.label}</h3><p>Storage deposit {formatUnits(nativeReview.storageDeposit,14)} tPOT · fee budget {formatUnits(nativeReview.fee,14)} tPOT</p><p>Signer {nativeReview.address}</p><button className="pp-primary" disabled={busy} onClick={()=>void run(async()=>{const review=nativeReview;setNativeReview(null);setPhase('Confirm in your wallet. Then wait for finalized network confirmation...');const result=await native.current!.signAndSend(review,localStorage);const receipt={...request.current!,txHash:result.hash as Hex,blockHash:result.blockHash as Hex};save(receipt);const value={...receipt,blockNumber:await native.current!.finalizedBlockNumber(result.blockHash)};save(value);native.current!.acknowledge(localStorage,result);if(review.label==='Approve my exact share'){localStorage.removeItem(key);request.current=null;setMessage('Approval finalized. Choose Pay my share to contribute.');}else await record(value);})}>Confirm in Polkadot.js</button><button className="pp-text" disabled={busy} onClick={()=>setNativeReview(null)}>Back</button></div>}
  {flow&&<>{!flow.transactionHash&&!flow.submissionUncertain&&<FlowReview state={flow} authorizationCount={authorizationCount} onConfirm={()=>void run(async()=>{const final=await executeFlow(reviewFlow(flow),port.current!,setFlow);if(final.finalized&&!final.receiptPending){setFlow(null);await load();}else if(!final.finalized)setMessage('Transaction submitted. Check its finality before continuing.');})} disabled={busy}/>}<FlowProgress state={flow}/></>}
  <button className="pp-text" disabled={busy} onClick={()=>void run(async()=>{const saved=request.current;if(saved?.txHash)await record(saved);else if(saved?.flow?.transactionHash){
    const receipt=await client().getTransactionReceipt({hash:saved.flow.transactionHash as Hex});
    const head=await client().getBlock({blockTag:'finalized'});
    if(receipt.blockNumber>head.number!)throw Error('The transaction is not finalized yet.');
    if(receipt.status!=='success'){localStorage.removeItem(key);request.current=null;setFlow(null);await load();throw Error('The transaction reverted on chain. You can prepare a fresh review.');}
    await record({...saved,txHash:saved.flow.transactionHash as Hex,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash});
   }else if(saved){
    if(saved.transport==='google')throw Error('No final transaction hash is saved. Check your Google wallet activity before starting another payment.');
    if(pending(localStorage)?.id!==saved.nativeId)throw Error('This pending transaction belongs to another review. Open its original booking to recover it.');
    const a=native.current??=await createNativeAdapter();const result=await a.recover(localStorage);const blockNumber=await a.finalizedBlockNumber(result.blockHash);if(saved.approval){localStorage.removeItem(key);request.current=null;setMessage('Approval finalized. Choose Pay my share again.');}
    else await record({...saved,txHash:result.hash as Hex,blockHash:result.blockHash as Hex,blockNumber});a.acknowledge(localStorage,result);}else await load();})}>Refresh payments or recover saved transaction</button>
  {busy&&!flow&&<p role="status">{phase}</p>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</div>
 </section>;
}
