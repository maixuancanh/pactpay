import {encodeFunctionData,parseAbi,type Address,type Hex} from 'viem';
import {parseNativePackage,serializeNativePackage,type NativeQuotePackage} from '../native/packages';
import type {FlowBinding} from '../flows/types';
import type {AccountCall} from './pact-account';
export type CompactAction='payment'|'merchant-payout'|'refund';
/** Caller supplies finalized contract reads, never inferred local payment status. */
export type CompactSnapshot={account:Address;chainId:number;escrow:Address;quoteId:Hex;termsHash:Hex;state:number;share:bigint;contribution:bigint;credit:bigint;held:bigint;now:bigint;expiresAt:number;evidence:string};
export type CompactPlan={binding:FlowBinding;calls:AccountCall[]};
const abi=parseAbi(['function approve(address,uint256) returns(bool)','function contribute(bytes32,bytes32)','function capture(bytes32)','function expire(bytes32)','function claim(bytes32)']);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export function createCompactCallPlan(x:{action:CompactAction;package:NativeQuotePackage;snapshot:CompactSnapshot;account:Address;feePayer:string;revision?:number;now?:number}):CompactPlan{
 const now=x.now??Date.now(),s=x.snapshot;
 const p=parseNativePackage(serializeNativePackage(x.package),{contract:x.package.contract,token:x.package.quote.token});
 if(!s.evidence||s.expiresAt<=now||s.now<0n||!same(s.account,x.account)||s.chainId!==p.chainId||!same(s.escrow,p.contract)||!same(s.quoteId,p.id)||!same(s.termsHash,p.quote.termsHash))throw Error('Account, chain or finalized agreement snapshot mismatch');
 const member=p.members.findIndex(a=>same(a,x.account)),q=p.quote;
 if(member>=0&&s.share!==p.shares[member])throw Error('Finalized member share differs');
 const call=(name:'capture'|'expire'|'claim')=>({target:p.contract,data:encodeFunctionData({abi,functionName:name,args:[p.id]})});
 let calls:AccountCall[],amount:bigint;
 if(x.action==='payment'){
  if(member<0||s.share<=0n||s.state!==1||s.contribution!==0n||s.now>=q.fundingDeadline)throw Error('Member payment unavailable or expired');
  amount=s.share;calls=[{target:q.token,data:encodeFunctionData({abi,functionName:'approve',args:[p.contract,amount]})},{target:p.contract,data:encodeFunctionData({abi,functionName:'contribute',args:[p.id,q.termsHash]})}];
 }else if(x.action==='merchant-payout'){
  if(!same(q.merchant,x.account))throw Error('Compact account is not agreement merchant');
  if(s.state===2&&s.now<q.captureDeadline&&s.held===q.total){amount=s.held+s.credit;calls=[call('capture'),call('claim')];}
  else if(s.state===3&&s.credit>0n){amount=s.credit;calls=[call('claim')];}
  else throw Error('Merchant payout unavailable or expired');
 }else{
  if(member<0)throw Error('Compact account is not refund member');
  const expiry=(s.state===1&&s.now>=q.fundingDeadline)||(s.state===2&&s.now>=q.captureDeadline);
  if(expiry&&s.contribution>0n){amount=s.contribution+s.credit;calls=[call('expire'),call('claim')];}
  else if((s.state===4||s.state===5)&&s.credit>0n){amount=s.credit;calls=[call('claim')];}
  else throw Error('Contributor refund unavailable');
 }
 return {calls,binding:{account:x.account,chainId:p.chainId,escrow:p.contract,quoteId:p.id,revision:x.revision??1,termsHash:q.termsHash,recipient:x.action==='payment'?p.contract:x.account,amount:String(amount),fee:'0',storage:'0',walletCreation:'0',feePayer:x.feePayer,estimateExpiresAt:s.expiresAt}};
}
