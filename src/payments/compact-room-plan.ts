import {decodeFunctionResult,encodeFunctionData,hashTypedData,keccak256,toHex,parseAbi,type Abi,type Address,type Hex} from 'viem';
import v1Json from '../lib/pact-abi.json';
import type {Room} from '../commerce/types';
import type {NativeAdapter} from '../native/adapter';
import {hashMembers,hashShares,quoteTypedData,type Quote} from '../features/quotes/schema';
import type {CompactPlan,CompactAction} from './compact-plan';
const abi=v1Json as Abi,tokenAbi=parseAbi(['function approve(address,uint256) returns(bool)']);
/** Finalized room/quote/roster reads; backend state alone never selects a money action. */
export async function readCompactRoomPlan(x:{room:Room;account:Address;feePayer:string;action:CompactAction;adapter:Pick<NativeAdapter,'readFinalizedCalls'>;expiresAt:number;now?:number}):Promise<CompactPlan>{
 const r=x.room,q=r.quote;if(!q||q.chainId!==420420777||!r.termsHash)throw Error('Published V3 booking required');
 const escrow=q.escrow as Address,id=q.quoteId as Hex;
 const request=(functionName:string,args:readonly unknown[])=>({to:escrow,data:encodeFunctionData({abi,functionName,args})});
 const read=await x.adapter.readFinalizedCalls(x.feePayer,[request('getQuote',[id]),request('shares',[id,x.account]),request('contributions',[id,x.account]),request('credits',[id,x.account])]);
 const now=x.now??Date.now();if(now-read.timestamp>180000||read.timestamp>now+60000||x.expiresAt<=now)throw Error('Finalized booking read is stale');
 const [terms,stateValue,held,members]=decodeFunctionResult({abi,functionName:'getQuote',data:read.values[0]}) as [Quote,number,bigint,Address[]];
 const share=decodeFunctionResult({abi,functionName:'shares',data:read.values[1]}) as bigint,paid=decodeFunctionResult({abi,functionName:'contributions',data:read.values[2]}) as bigint,credit=decodeFunctionResult({abi,functionName:'credits',data:read.values[3]}) as bigint;
 const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 if(!same(terms.termsHash,r.termsHash)||terms.total!==BigInt(r.total)||!same(hashTypedData(quoteTypedData(420420777,escrow,terms)),id)||!same(hashMembers(r.members.map(m=>m.accountAddress as Address)),terms.membersHash)||!same(hashShares(r.members.map(m=>BigInt(m.share))),terms.sharesHash)||members.length!==r.members.length||members.some((m,i)=>!same(m,r.members[i].accountAddress))||terms.fundingDeadline!==BigInt(Math.floor(Date.parse(r.fundingDeadline)/1000))||terms.captureDeadline!==BigInt(Math.floor(Date.parse(r.serviceAt)/1000)))throw Error('Finalized quote differs from reviewed booking');
 if(r.merchantAccountAddress&&!same(terms.merchant,r.merchantAccountAddress))throw Error('Booking merchant account changed');
 const member=r.members.find(m=>same(m.accountAddress,x.account));if(member&&BigInt(member.share)!==share)throw Error('Finalized share differs');
 const state=Number(stateValue),timestamp=BigInt(Math.floor(read.timestamp/1000));const call=(name:string)=>({target:escrow,data:encodeFunctionData({abi,functionName:name,args:[id]})});let calls:CompactPlan['calls'],amount:bigint;
 if(x.action==='payment'){if(!member||share<=0n||paid!==0n||state!==1||timestamp>=terms.fundingDeadline)throw Error('Payment is unavailable');amount=share;calls=[{target:terms.token,data:encodeFunctionData({abi:tokenAbi,functionName:'approve',args:[escrow,share]})},{target:escrow,data:encodeFunctionData({abi,functionName:'contribute',args:[id,terms.termsHash]})}];}
 else if(x.action==='merchant-payout'){if(!same(terms.merchant,x.account))throw Error('Merchant account required');if(state===2&&held===terms.total&&timestamp<terms.captureDeadline){amount=held+credit;calls=[call('capture'),call('claim')];}else if(state===3&&credit>0n){amount=credit;calls=[call('claim')];}else throw Error('Merchant payout is unavailable');}
 else{if(!member)throw Error('Member refund account required');const expired=(state===1&&timestamp>=terms.fundingDeadline)||(state===2&&timestamp>=terms.captureDeadline);if(expired&&paid>0n){amount=paid+credit;calls=[call('expire'),call('claim')];}else if(credit>0n){amount=credit;calls=[call('claim')];}else throw Error('No refund is available');}
 return {calls,binding:{account:x.account,chainId:420420777,escrow,quoteId:id,revision:r.revision,termsHash:r.termsHash,recipient:x.action==='payment'?escrow:x.account,amount:String(amount),fee:'0',storage:'0',walletCreation:'0',feePayer:x.feePayer,estimateExpiresAt:x.expiresAt}};
}

export async function readCompactPublishPlan(x:{room:Room&{canonicalTerms?:string};account:Address;feePayer:string;adapter:Pick<NativeAdapter,'readFinalizedCalls'>;escrow:Address;expiresAt:number}):Promise<CompactPlan>{
 const r=x.room;if(r.status!=='locked'&&r.status!=='publishing')throw Error('Locked booking required');
 if(!r.canonicalTerms||keccak256(toHex(r.canonicalTerms))!==r.termsHash||r.merchantAccountAddress?.toLowerCase()!==x.account.toLowerCase()||!r.members.length||r.members.length>5||r.members.some(m=>m.acceptedRevision!==r.revision)||r.members.reduce((s,m)=>s+BigInt(m.share),0n)!==BigInt(r.total))throw Error('Booking account, terms or roster consent differs');
 const reads=await x.adapter.readFinalizedCalls(x.feePayer,[{to:x.escrow,data:encodeFunctionData({abi,functionName:'token'})}]);
 if(Date.now()-reads.timestamp>180000||reads.timestamp>Date.now()+60000)throw Error('Finalized network read is stale');
 const token=decodeFunctionResult({abi,functionName:'token',data:reads.values[0]}) as Address;
 const members=r.members.map(m=>m.accountAddress as Address),shares=r.members.map(m=>BigInt(m.share));
 const quote:Quote={merchant:x.account,token,nonce:BigInt(keccak256(toHex('pactpay:room:'+r.id+':'+r.revision))),termsHash:r.termsHash as Hex,membersHash:hashMembers(members),sharesHash:hashShares(shares),total:BigInt(r.total),fundingDeadline:BigInt(Math.floor(Date.parse(r.fundingDeadline)/1000)),captureDeadline:BigInt(Math.floor(Date.parse(r.serviceAt)/1000))};
 if(quote.fundingDeadline<=BigInt(Math.floor(reads.timestamp/1000)))throw Error('Funding deadline passed');
 const quoteId=hashTypedData(quoteTypedData(420420777,x.escrow,quote));return {calls:[{target:x.escrow,data:encodeFunctionData({abi,functionName:'createQuoteNativeWithTerms',args:[quote,members,shares,r.canonicalTerms]})}],binding:{account:x.account,chainId:420420777,escrow:x.escrow,quoteId,revision:r.revision,termsHash:quote.termsHash,recipient:x.escrow,amount:r.total,fee:'0',storage:'0',walletCreation:'0',feePayer:x.feePayer,estimateExpiresAt:x.expiresAt}};
}
