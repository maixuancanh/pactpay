import {api} from './api';
import type {IndexedEvidence} from './evidence';
export async function syncEvidence(read = (path:string)=>api<{events:IndexedEvidence[];nextCursor?:string|null}>(path)):Promise<IndexedEvidence[]> {
 const events:IndexedEvidence[]=[];const seen=new Set<string>();let after:string|null=null;
 do {const page=await read('/sync'+(after?'?after='+encodeURIComponent(after):''));events.push(...page.events);after=page.nextCursor??null;if(after){if(seen.has(after))throw Error('Booking history sync stalled. Try again.');seen.add(after);}}while(after);
 return events;
}
