import {hashTypedData,isAddress,type Address,type Hex} from 'viem';
import {hashTerms,hashMembers,hashShares,quoteTypedData,type Quote,type Terms} from '../features/quotes/schema';
export type NativeQuotePackage={schema:'pactpay-native-v1';chainId:420420777;contract:Address;terms:Terms;quote:Quote;members:Address[];shares:bigint[];id:Hex};
export const serializeNativePackage=(p:NativeQuotePackage)=>JSON.stringify(p,(_,v)=>typeof v==='bigint'?String(v):v,2);
export function parseNativePackage(raw:string,deployment:{contract:Address;token:Address}):NativeQuotePackage{
 if(raw.length>50000)throw Error('Agreement file is too large.');
 const p=JSON.parse(raw),t=p.terms;
 const exact=(value:unknown,allowed:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Unexpected fields in agreement package.');};
 exact(p,['schema','chainId','contract','terms','quote','members','shares','id']);
 exact(t,['title','description','merchantName','currency']);
 exact(p.quote,['merchant','token','nonce','termsHash','membersHash','sharesHash','total','fundingDeadline','captureDeadline']);
 if(p.schema!=='pactpay-native-v1'||p.chainId!==420420777||!isAddress(p.contract)||p.contract.toLowerCase()!==deployment.contract.toLowerCase())throw Error('This agreement belongs to a different network or contract.');
 if(!t||typeof t.title!=='string'||!t.title.trim()||t.title.length>120||typeof t.description!=='string'||t.description.length>4000||typeof t.merchantName!=='string'||t.merchantName.length>100||t.currency!=='dUSD')throw Error('Invalid agreement terms.');
 const q={...p.quote};
 for(const field of ['nonce','total','fundingDeadline','captureDeadline']){if(typeof q[field]!=='string'||!/^\d+$/.test(q[field]))throw Error('Invalid amount or deadline.');q[field]=BigInt(q[field]);}
 if(!isAddress(q.merchant)||!isAddress(q.token)||q.token.toLowerCase()!==deployment.token.toLowerCase())throw Error('Wrong payment token or merchant.');
 if(!Array.isArray(p.members)||p.members.length<1||p.members.length>5||p.members.some((m:unknown)=>typeof m!=='string'||!isAddress(m)||/^0x0{40}$/i.test(m))||new Set(p.members.map((m:string)=>m.toLowerCase())).size!==p.members.length)throw Error('One to five distinct nonzero members are required.');
 if(!Array.isArray(p.shares)||p.shares.length!==p.members.length||p.shares.some((s:unknown)=>typeof s!=='string'||!/^\d+$/.test(s)))throw Error('Invalid fixed shares.');
 const shares=p.shares.map(BigInt);
 if(shares.some((s:bigint)=>s<=0n)||shares.reduce((a:bigint,b:bigint)=>a+b,0n)!==q.total||q.fundingDeadline>=q.captureDeadline)throw Error('Invalid total, shares or deadlines.');
 if(hashTerms(t)!==q.termsHash||hashMembers(p.members)!==q.membersHash||hashShares(shares)!==q.sharesHash||hashTypedData(quoteTypedData(p.chainId,p.contract,q))!==p.id)throw Error('Agreement content or identity was modified.');
 return {schema:p.schema,chainId:p.chainId,contract:p.contract,terms:t,quote:q,members:p.members,shares,id:p.id};
}
