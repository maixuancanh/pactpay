import type { FlowState } from './types';
export function journalKey(s:FlowState):string {const b=s.binding;return ['pactpay:flow:v2',b.chainId,b.account.toLowerCase(),b.escrow.toLowerCase(),b.quoteId,s.kind,b.actionId??s.kind].join(':');}
export function saveFlow(storage:Pick<Storage,'setItem'>,s:FlowState):void {storage.setItem(journalKey(s),JSON.stringify(s));}
export function restoreFlow(storage:Pick<Storage,'getItem'>,expected:FlowState):FlowState|null {try {const raw=storage.getItem(journalKey(expected));if(!raw)return null;const s=JSON.parse(raw) as FlowState;if(journalKey(s)!==journalKey(expected)||!Array.isArray(s.steps))return null;return {...s,reviewed:undefined};}catch{return null;}}
/** Cross-tab mutex. Backend idempotency and canonical finalized reads remain necessary across devices. */
export async function withFlowLock<T>(key:string,action:()=>Promise<T>):Promise<T> {if(typeof navigator==='undefined'||!navigator.locks)throw Error('Cross-tab payment lock unavailable');return navigator.locks.request(key,{ifAvailable:true},async lock=>{if(!lock)throw Error('Payment is active in another tab');return action();});}
