import {it,expect} from 'vitest';
import {paymentTimeline,settlementSummary} from './payment-timeline';
const event=(name:string,args:any,i:number)=>({event:name,args:{quoteId:'q',...args},transactionHash:'tx'+i,logIndex:i,blockNumber:BigInt(i),receiptStatus:'success'});
it('orders funding, capture and payout by verified events rather than final balance',()=>{
 const snapshot={id:'q',state:'Captured',total:10n,merchant:'m',merchantCredit:0n,finalizedBlock:4n,blockHash:'h',events:[event('Claimed',{recipient:'m',amount:10n},4),event('QuoteCreated',{},1),event('Contributed',{member:'a',amount:10n},2),event('StateChanged',{state:3},3)],members:[],historyCoverage:{status:'complete'}};
 expect(paymentTimeline(snapshot).map(x=>x.kind)).toEqual(['created','contribution','capture','payout']);
 expect(settlementSummary(snapshot).status).toBe('payout-verified');
 expect(settlementSummary({...snapshot,events:[]}).status).toBe('closed-unverified');
});
it('does not infer every refund from one recipient or duplicate event',()=>{
 const e=event('Claimed',{recipient:'a',amount:5n},3);const snapshot={id:'q',state:'Cancelled',total:10n,merchant:'m',merchantCredit:0n,finalizedBlock:4n,blockHash:'h',events:[event('StateChanged',{state:4},2),e,e],members:[{address:'a',share:5n,claimable:0n},{address:'b',share:5n,claimable:5n}],historyCoverage:{status:'partial'}};
 expect(paymentTimeline(snapshot).filter(x=>x.kind==='refund')).toHaveLength(1);
 expect(settlementSummary(snapshot).status).toBe('refund-available');
 expect(settlementSummary(snapshot).coverage).toBe('partial');
});
