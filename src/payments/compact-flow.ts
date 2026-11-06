import {decodeFunctionResult,encodeFunctionData,hashTypedData,isAddress,parseAbi,recoverTypedDataAddress,type Address,type Hex} from 'viem';
import type {NativeAdapter,PreparedNativeTx} from '../native/adapter';
import type {FlowBinding,FlowPort,FlowState} from '../flows/types';
import {fingerprint} from '../flows/engine';
import {compactAuthorization,compactExecution} from './compact-account';
import type {CompactPlan} from './compact-plan';
export type CompactTypedAuthorization=ReturnType<typeof compactAuthorization>;
export type CompactFlowConfig={
 account:Address;owner:Address;chainId:420420777;feePayer:{native:string;h160:Address};
 adapter:Pick<NativeAdapter,'identity'|'account'|'readContractData'|'prepareCall'>;
 /** Authoritative slot-zero nonce for this exact deployed compact account. */
 readNonce:()=>Promise<bigint>;
 signer:{identity:()=>Promise<{account:Address;chainId:number}>;signTypedData:(typed:CompactTypedAuthorization)=>Promise<Hex>};
 plan:()=>Promise<CompactPlan>;
 /** Preliminary reviewed budgets, not an exact signed whole-call simulation. */
 feeCap:bigint;storageCap:bigint;preliminaryEvidence:string;expiresAt:number;deadline:bigint;
 /** Show the exact simulated method, fee and storage and request manual payer consent. */
 reviewFeePayer:(prepared:Readonly<PreparedNativeTx>,binding:Readonly<FlowBinding>)=>Promise<boolean>;
 /** Native wallet authorization and send. No server signer keys. */
 send:(prepared:PreparedNativeTx)=>Promise<Hex>;
 confirm:(hash:Hex)=>Promise<'finalized'|'failed'|'unknown'>;receipt:(hash:Hex)=>Promise<void>;
 persist:(state:FlowState)=>Promise<void>;now?:()=>number;
};
const ownerAbi=parseAbi(['function owner() view returns(address)']);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
/** One owner signature followed by a separately reviewed native payer authorization. */
export function createCompactFlow(c:CompactFlowConfig):FlowPort{
 const now=c.now??Date.now;
 if(c.chainId!==420420777||![c.account,c.owner,c.feePayer.h160].every(a=>isAddress(a))||!c.feePayer.native||c.feeCap<=0n||c.storageCap<0n||!c.preliminaryEvidence)throw Error('Verified identities and preliminary cost caps required');
 let selected:CompactPlan|undefined,review:FlowBinding|undefined,nonce:bigint|undefined,signature:Hex|undefined,prepared:PreparedNativeTx|undefined,signing=false,sending=false,attempted=false,submitted:Hex|undefined;
 const unexpired=()=>{if(now()>=c.expiresAt||c.deadline<=BigInt(Math.floor(now()/1000)))throw Error('Compact authorization or cost review expired');};
 async function verify(){
  unexpired();
  const [identity,actor]=await Promise.all([c.signer.identity(),c.adapter.account(c.feePayer.native),c.adapter.identity()]);
  if(identity.chainId!==c.chainId||!same(identity.account,c.owner)||!actor.mapped||!same(actor.h160,c.feePayer.h160)||actor.spendable<c.feeCap+c.storageCap)throw Error('Compact owner, chain or native fee payer changed');
  const raw=await c.adapter.readContractData(c.feePayer.native,c.account,encodeFunctionData({abi:ownerAbi,functionName:'owner'}));
  if(!same(decodeFunctionResult({abi:ownerAbi,functionName:'owner',data:raw}),c.owner))throw Error('Compact account owner differs; existing agreement ownership cannot change');
  const actual=await c.readNonce();if(typeof actual!=='bigint'||actual<0n)throw Error('Authoritative compact nonce unavailable');
  return actual;
 }
 async function preflight(){
  if(attempted)throw Error('Reconcile previous compact submission before retry');
  const actual=await verify(),plan=await c.plan();
  if(!same(plan.binding.account,c.account)||plan.binding.chainId!==c.chainId||plan.binding.feePayer!==c.feePayer.native||plan.binding.estimateExpiresAt<=now()||plan.calls.length<1||plan.calls.length>2||plan.calls.some(call=>!isAddress(call.target)||same(call.target,c.account)||!/^0x(?:[a-f\d]{2}){4,}$/i.test(call.data)))throw Error('Compact plan identity or exact calls invalid');
  const calls=plan.calls.map(call=>({...call}));
  const auth=compactAuthorization(c.account,c.chainId,calls,c.feePayer.h160,actual,c.deadline);
  const binding:FlowBinding={...plan.binding,actionId:'compact:'+hashTypedData(auth),fee:String(c.feeCap),storage:String(c.storageCap),walletCreation:'0',estimateExpiresAt:Math.min(plan.binding.estimateExpiresAt,c.expiresAt,Number(c.deadline)*1000)};
  if(signature&&(!review||fingerprint(review)!==fingerprint(binding)||actual!==nonce))throw Error('Compact plan or nonce changed after owner authorization');
  selected={binding,calls};review=binding;nonce=actual;return {...binding};
 }
 return {
  submitIncludesAuthorization:true,
  submissionState(){return {submissionUncertain:attempted&&!submitted,...(submitted?{transactionHash:submitted}:{})};},
  persistAttempt:c.persist,preflight,
  async authorize(binding){
   if(signing||signature)throw Error('Owner authorization already requested');
   signing=true;
   try{
    const fresh=await preflight();if(fingerprint(binding)!==fingerprint(fresh)||!selected||nonce===undefined)throw Error('Review exact compact plan before signing');
    const typed=compactAuthorization(c.account,c.chainId,selected.calls,c.feePayer.h160,nonce,c.deadline);
    const signed=await c.signer.signTypedData(typed);
    if(!same(await recoverTypedDataAddress({...typed,signature:signed}),c.owner))throw Error('Invalid compact owner signature');
    signature=signed;
    await preflight();
    const tx=await c.adapter.prepareCall(c.feePayer.native,c.account,compactExecution(selected!.calls,nonce!,c.deadline,signed),'Compact atomic '+binding.quoteId);
    if(tx.address!==c.feePayer.native||tx.kind!=='call'||tx.fee<0n||tx.storageDeposit<0n||tx.fee>c.feeCap||tx.storageDeposit>c.storageCap)throw Error('Signed whole-call simulation exceeds reviewed cost caps');
    prepared={...tx,weight:{...tx.weight}};
   }finally{signing=false;}
  },
  async submit(binding){
   if(attempted||sending)throw Error('Reconcile previous compact submission before retry');
   sending=true;
   try{
    if(!signature||!prepared||!review||fingerprint(binding)!==fingerprint(review))throw Error('Owner authorization and whole-call simulation required');
    await preflight();
    const tx={...prepared,weight:{...prepared.weight}};
    if(now()-tx.createdAt>300000)throw Error('Native fee review expired');
    if(!await c.reviewFeePayer(Object.freeze({...tx,weight:Object.freeze({...tx.weight})}),Object.freeze({...binding})))throw Object.assign(Error('Native fee payer declined'),{code:4001});
    await preflight();
    attempted=true;
    submitted=await c.send(tx);return submitted;
   }finally{sending=false;}
  },
  confirm(hash){return c.confirm(hash as Hex);},receipt(hash){return c.receipt(hash as Hex);}
 };
}
