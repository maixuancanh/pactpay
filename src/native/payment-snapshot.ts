import type {ClaimKind} from './payment-status';
export function claimKindFromEvents(events:any[],state:number,quoteId:string,actor:string|undefined,merchant:string,expected:bigint):ClaimKind{
 if(!actor||expected<=0n)return 'unknown';const seen=new Set<string>();let paid=0n;
 for(const e of events){const key=`${e.transactionHash}:${e.logIndex}`;if(seen.has(key))continue;seen.add(key);if(e.event!=='Claimed'||e.receiptStatus!=='success'||String(e.args?.quoteId).toLowerCase()!==quoteId.toLowerCase()||String(e.args?.recipient).toLowerCase()!==actor.toLowerCase())continue;const amount=BigInt(e.args.amount);if(amount<=0n)return 'unknown';paid+=amount;}
 if(paid!==expected)return 'unknown';
 return state===3&&actor.toLowerCase()===merchant.toLowerCase()?'merchant-payout':state===4||state===5?'contributor-refund':'unknown';
}
