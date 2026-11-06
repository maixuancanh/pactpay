import { withFlowLock } from './journal';
import type { FlowBinding, FlowKind, FlowState, FlowPort } from './types';
export function fingerprint(b: FlowBinding): string { return JSON.stringify([b.actionId,b.account.toLowerCase(),b.chainId,b.escrow.toLowerCase(),b.quoteId,b.revision,b.termsHash,b.recipient.toLowerCase(),b.amount,b.fee,b.storage,b.walletCreation,b.feePayer,b.estimateExpiresAt,b.nativeDecimals,b.costModel,b.reviewLabel]); }
export function createFlow(kind: FlowKind, binding: FlowBinding): FlowState { return { kind, binding, finalized: false, receiptPending: false, steps: [{id:'review',label:'Review the payment',status:'pending'},{id:'authorize',label:'Confirm in your wallet',status:'pending'},{id:'confirm',label:'Wait for network confirmation',status:'pending'},{id:'receipt',label:'Update receipt',status:'pending'}] }; }
export function reviewFlow(s: FlowState, now = Date.now()): FlowState { if (s.transactionHash || s.submissionUncertain || s.binding.estimateExpiresAt <= now) throw Error('Review unavailable or expired'); return {...s,reviewed:fingerprint(s.binding),steps:s.steps.map(x=>x.id==='review'?{...x,status:'confirmed'}:x)}; }
export function cancelFlow(s: FlowState): FlowState { if(s.transactionHash || s.submissionUncertain) throw Error('A submitted transaction cannot be cancelled here'); return {...s,reviewed:undefined}; }
export async function reconcileFlow(s: FlowState, port: FlowPort, emit: (s: FlowState)=>void): Promise<FlowState> {
 if(!s.transactionHash) throw Error('No transaction to reconcile');
 let result: 'finalized' | 'failed' | 'unknown'; try { result = await port.confirm(s.transactionHash); } catch { result = 'unknown'; }
 s={...s,finalized:result==='finalized',receiptPending:result==='finalized',steps:s.steps.map(x=>x.id==='confirm'?{...x,status:result==='finalized'?'confirmed':result==='failed'?'failed':'unknown'}:x)}; emit(s);
 if(s.finalized) { try { await port.receipt(s.transactionHash!); s={...s,receiptPending:false,steps:s.steps.map(x=>x.id==='receipt'?{...x,status:'confirmed'}:x)}; } catch { s={...s,steps:s.steps.map(x=>x.id==='receipt'?{...x,status:'unknown',detail:'Payment finalized. Receipt is still updating.'}:x)}; } emit(s); } return s;
}
const running = new Set<string>();
const attempted = new Set<string>();
async function executeUnlocked(s: FlowState, port: FlowPort, emit: (s: FlowState)=>void, now=Date.now()): Promise<FlowState> {
 if(s.transactionHash) return reconcileFlow(s,port,emit);
 const key=[s.binding.account,s.binding.chainId,s.binding.escrow,s.binding.quoteId,s.kind,s.binding.actionId??s.kind].join(':').toLowerCase();
 if(s.submissionUncertain || attempted.has(key) || (typeof localStorage !== 'undefined' && localStorage.getItem('pactpay:attempt:'+key))) throw Error('Reconcile the previous submission before any retry');
 if(running.has(key)) throw Error('This action is already running'); running.add(key);
 try {
 const current=await port.preflight(); if(s.reviewed!==fingerprint(current) || current.estimateExpiresAt<=now) throw Error('Payment details changed. Review again.');
 s={...s,steps:s.steps.map(x=>x.id==='authorize'?{...x,status:'awaiting-user'}:x)}; emit(s);
 try { await port.authorize(current); } catch(e) { s={...s,reviewed:undefined,steps:s.steps.map(x=>x.id==='authorize'?{...x,status:'failed',detail:'Wallet authorization declined or unavailable. Review to try again.'}:x)}; emit(s); throw e; }
 // Identity/cost changes during the wallet prompt invalidate the consent.
 const after=await port.preflight(); if(fingerprint(after)!==s.reviewed || after.estimateExpiresAt<=Date.now()) throw Error('Payment details changed during authorization');
 s={...s,steps:s.steps.map(x=>x.id==='authorize'?{...x,status:port.submitIncludesAuthorization?'awaiting-user':'confirmed'}:x.id==='confirm'?{...x,status:'running'}:x)}; emit(s);
 // A transport must journal broadcast attempts before sending and return the known hash.
 // Any ambiguous send is terminal unknown; never automatically retry a write.
 s={...s,attemptId:crypto.randomUUID(),submissionUncertain:true};
 if(typeof localStorage !== 'undefined') localStorage.setItem('pactpay:attempt:'+key,JSON.stringify(s));
 if(port.persistAttempt) await port.persistAttempt(s);
 attempted.add(key); emit(s);
 try { s={...s,transactionHash:await port.submit(after),...port.submissionState?.(),submissionUncertain:false,steps:s.steps.map(x=>x.id==='authorize'?{...x,status:'confirmed'}:x)}; if(typeof localStorage !== 'undefined') localStorage.setItem('pactpay:attempt:'+key,JSON.stringify(s)); if(port.persistAttempt) await port.persistAttempt(s); } catch(e) { const rejected=typeof e==='object'&&e!==null&&'code' in e&&e.code===4001;if(rejected){attempted.delete(key);if(typeof localStorage!=='undefined')localStorage.removeItem('pactpay:attempt:'+key);}s={...s,...port.submissionState?.(),submissionUncertain:!rejected,reviewed:undefined,steps:s.steps.map(x=>x.id==='confirm'?{...x,status:rejected?'failed':'unknown',detail:rejected?'Wallet request declined. Review to try again.':'Submission uncertain. Reconcile before trying again.'}:x)};if(port.persistAttempt)await port.persistAttempt(s); emit(s); return s; }
 emit(s); return await reconcileFlow(s,port,emit);
 } finally { running.delete(key); }
}

/** Browser writes hold a cross-tab Web Lock. Cross-device ports must also use server idempotency. */
export async function executeFlow(s: FlowState, port: FlowPort, emit: (s: FlowState)=>void, now=Date.now()): Promise<FlowState> {
 const key=[s.binding.account,s.binding.chainId,s.binding.escrow,s.binding.quoteId,s.kind,s.binding.actionId??s.kind].join(':').toLowerCase();
 if(typeof window !== 'undefined') return withFlowLock('pactpay:'+key,()=>executeUnlocked(s,port,emit,now));
 return executeUnlocked(s,port,emit,now);
}
