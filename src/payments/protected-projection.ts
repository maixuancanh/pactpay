export type ProtectedEvent={chainId:number;contract:string;transactionHash:string;logIndex:number;blockNumber:string;blockHash:string;name:'Created'|'Funded'|'Captured'|'Disputed'|'Settled'|'Claimed';args:Record<string,string>};
export type ProtectedProjection={version:'protected-v2';seen:string[];bookings:Record<string,{merchant?:string;termsHash?:string;complaintDeadline?:string;resolutionDeadline?:string;members:Record<string,{paid:string;disputed:boolean;settled:boolean;refund:string;payout:string}>}>;credits:Record<string,string>};
export function emptyProtectedProjection():ProtectedProjection{return {version:'protected-v2',seen:[],bookings:{},credits:{}};}
/** Ordered finalized full-history projection; output is indexed evidence, not a substitute for RPC reads. */
export function applyProtectedEvent(previous:ProtectedProjection,e:ProtectedEvent):ProtectedProjection{
 const key=[e.chainId,e.contract.toLowerCase(),e.transactionHash.toLowerCase(),e.logIndex].join(':');if(previous.seen.includes(key))return previous;
 const s=structuredClone(previous);s.seen.push(key);const a=e.args;
 const credit=(recipient:string,delta:bigint)=>{const k=recipient.toLowerCase();const next=BigInt(s.credits[k]??'0')+delta;if(next<0n)throw Error('Incomplete V2 event coverage: credit underflow');s.credits[k]=next.toString();};
 if(e.name==='Claimed'){credit(a.recipient,-BigInt(a.amount));return s;}
 const id=a.bookingId;const b=s.bookings[id]??={members:{}};
 if(e.name==='Created'){if(b.merchant)throw Error('Duplicate V2 booking creation');b.merchant=a.merchant;b.termsHash=a.termsHash;}
 if(e.name==='Captured'){b.complaintDeadline=a.complaintDeadline;b.resolutionDeadline=a.resolutionDeadline;}
 if(['Funded','Disputed','Settled'].includes(e.name)){const member=a.member.toLowerCase();const p=b.members[member]??={paid:'0',disputed:false,settled:false,refund:'0',payout:'0'};
  if(e.name==='Funded'){if(p.paid!=='0')throw Error('Duplicate funding evidence');p.paid=a.amount;}
  if(e.name==='Disputed')p.disputed=true;
  if(e.name==='Settled'){if(p.settled||BigInt(a.refund)+BigInt(a.payout)!==BigInt(p.paid)||!b.merchant)throw Error('Invalid or incomplete V2 settlement evidence');p.settled=true;p.refund=a.refund;p.payout=a.payout;credit(member,BigInt(a.refund));credit(b.merchant,BigInt(a.payout));}
  b.members[member]=p;
 }s.bookings[id]=b;return s;
}
