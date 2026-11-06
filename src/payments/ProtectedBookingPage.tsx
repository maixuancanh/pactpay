import {protectedNextAction} from './protected-action';

import {useEffect,useState} from 'react';

import {formatUnits,parseUnits,type Address,type Hex} from 'viem';

import {createFlow,reviewFlow,executeFlow} from '../flows/engine';

import type {FlowBinding,FlowState,FlowPort,FlowKind} from '../flows/types';

import {FlowReview} from '../flows/FlowReview';

import {FlowProgress} from '../flows/FlowProgress';

import type {ProtectedAction} from './protected-flow-port';

import {createProtectedReader,type ProtectedDeployment} from './protected-adapter';

export type ProtectedResolution={refund:bigint;signatureDeadline:bigint;buyerSignature:Hex;merchantSignature:Hex};

export type ProtectedFlowFactory=(action:ProtectedAction,resolution?:ProtectedResolution)=>Promise<{binding:FlowBinding;port:FlowPort;authorizationCount?:number}>;

export function ProtectedBookingPage({deployment,quoteId,member,actor,flowFactory,onSignResolution}:{deployment:ProtectedDeployment;quoteId:Hex;member:Address;actor?:Address;flowFactory?:ProtectedFlowFactory;onSignResolution?:(proposal:{refund:bigint;deadline:bigint;nonce:bigint;member:Address})=>Promise<{role:'buyer'|'merchant';signature:Hex}>}){

 const [authorizationCount,setAuthorizationCount]=useState(1);

 const [flow,setFlow]=useState<FlowState|null>(null);const [port,setPort]=useState<FlowPort|null>(null);const [preparing,setPreparing]=useState(false);

 async function prepare(action:ProtectedAction,resolution?:ProtectedResolution){if(!flowFactory)return;setPreparing(true);try{const p=await flowFactory(action,resolution);const kind:FlowKind=action==='capture'?'merchant-payout':action==='cancel'?'cancel':action==='contribute'?'payment':'refund';setAuthorizationCount(p.authorizationCount??1);setPort(p.port);setFlow(createFlow(kind,await p.port.preflight()));}catch(e){setError(e instanceof Error?e.message:'Review unavailable');}finally{setPreparing(false);}}

 async function confirm(){if(!flow||!port)return;try{const reviewed=reviewFlow(flow);setFlow(reviewed);await executeFlow(reviewed,port,setFlow);}catch(e){setError(e instanceof Error?e.message:'Action unavailable');}}

 const [data,setData]=useState<Awaited<ReturnType<ReturnType<typeof createProtectedReader>['read']>>|null>(null),[error,setError]=useState('');

 useEffect(()=>{let stop=false;let timer:ReturnType<typeof setTimeout>;const reader=createProtectedReader(deployment);let failures=0;async function tick(){try{const d=await reader.read(quoteId,member,actor??member);if(!stop){setData(d);setError('');}failures=0;}catch(e){if(!stop)setError(e instanceof Error?e.message:'Protected booking unavailable');failures++;}if(!stop)timer=setTimeout(tick,Math.min(60000,10000*2**failures));}void tick();return()=>{stop=true;clearTimeout(timer);};},[deployment.rpcUrl,deployment.address,deployment.chainId,quoteId,member,actor]);

 const booking=data?.booking as {merchant:Address;capturedAt:bigint;window:bigint;resolutionPeriod:bigint;fundingDeadline:bigint;captureDeadline:bigint;funded:bigint;total:bigint;state:number}|undefined;

 const position=data?.position as readonly [bigint,bigint,bigint,boolean,boolean]|undefined;

 const action=data&&booking&&position&&actor?protectedNextAction({booking,position,actor,member,timestamp:data.timestamp,actorCredit:data.actorCredit as bigint}):null;



 return <main><h1>Protected booking · V2</h1><p>This policy applies to this separate V2 contract. It does not change V1 orders.</p>{error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Reading finalized settlement state…</p>}{data&&<><p>Finalized block {data.blockNumber.toString()}</p><dl><dt>Your paid share</dt><dd>{formatUnits(position?.[1]??0n,6)} demo dUSD</dd><dt>Dispute</dt><dd>{position?.[3]?'Open':'None recorded'}</dd><dt>Position</dt><dd>{position?.[4]?'Settled into credits':'Held'}</dd><dt>Your available credit</dt><dd>{formatUnits(data.actorCredit as bigint,6)} demo dUSD</dd></dl>{booking&&booking.capturedAt>0n&&<p>Complaint deadline: {new Date(Number(booking.capturedAt+booking.window)*1000).toLocaleString()}. Resolution deadline: {new Date(Number(booking.capturedAt+booking.window+booking.resolutionPeriod)*1000).toLocaleString()}.</p>}<p>Available credit is not proof of a transfer to your wallet. A claim needs your wallet authorization. Unresolved disputes default to the buyer after the fixed resolution deadline.</p><details><summary>Contract and source</summary><p style={{overflowWrap:'anywhere'}}>Chain {deployment.chainId}; contract {deployment.address}; quote {quoteId}; source {data.source}; block {data.blockHash}</p></details>{position?.[3]&&!position?.[4]&&<details><summary>Propose a mutually signed split</summary><p>Both buyer and merchant must sign the same bounded EIP-712 Resolution. Neither a login nor a pasted proposal moves money.</p><form onSubmit={e=>{e.preventDefault();try{const f=new FormData(e.currentTarget);const buyerSignature=String(f.get('buyer')) as Hex,merchantSignature=String(f.get('merchant')) as Hex;if(!/^0x[0-9a-fA-F]+$/.test(buyerSignature)||!/^0x[0-9a-fA-F]+$/.test(merchantSignature))throw Error('Both signatures are required');void prepare('resolve',{refund:parseUnits(String(f.get('refund')),6),signatureDeadline:BigInt(Math.floor(Date.parse(String(f.get('deadline')))/1000)),buyerSignature,merchantSignature});}catch(e){setError(e instanceof Error?e.message:'Invalid resolution');}}}>{onSignResolution&&<button type="button" onClick={async e=>{try{const form=e.currentTarget.form;if(!form)return;const f=new FormData(form);const result=await onSignResolution({refund:parseUnits(String(f.get('refund')),6),deadline:BigInt(Math.floor(Date.parse(String(f.get('deadline')))/1000)),nonce:position?.[2]??0n,member});const field=form.elements.namedItem(result.role==='buyer'?'buyer':'merchant') as HTMLTextAreaElement|null;if(field)field.value=result.signature;}catch(e){setError(e instanceof Error?e.message:'Signature unavailable');}}}>Sign this split with my wallet</button>}<label>Buyer refund · demo dUSD<input name="refund" required inputMode="decimal"/></label><label>Signature deadline<input name="deadline" type="datetime-local" required/></label><label>Buyer signature<textarea name="buyer" required/></label><label>Merchant signature<textarea name="merchant" required/></label><button disabled={!flowFactory||preparing}>Review mutual resolution</button></form></details>}{action&&<button disabled={!flowFactory||preparing} onClick={()=>void prepare(action!)}>{preparing?'Preparing review…':action==='claim'?'Claim your available credit':action==='dispute'?'Open a dispute':action==='settle'?'Settle this member’s held share':action==='capture'?'Review capture':'Review your contribution'}</button>}{!flowFactory&&<p>Transactions require an explicitly configured and verified V2 wallet adapter.</p>}{flow&&<>{!flow.reviewed&&!flow.transactionHash&&!flow.submissionUncertain&&<FlowReview state={flow} authorizationCount={authorizationCount} onConfirm={()=>void confirm()}/>}<FlowProgress state={flow}/></>}</>}</main>;

}
