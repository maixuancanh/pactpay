import {it,expect} from 'vitest';
import {protectedOutcome,type ProtectedReceiptEvent} from './protected-outcome';
const buyer='0xbuyer';
const settlement:ProtectedReceiptEvent={event_name:'Settled',block_number:'10',log_index:1,tx_hash:'settle',event_args:{member:buyer,refund:'10000',payout:'0'}};
it('does not infer a received refund from zero credit or settlement alone',()=>{
 expect(protectedOutcome(buyer,'10000',true,3,[])).toContain('awaiting verification');
 expect(protectedOutcome(buyer,'10000',true,3,[settlement])).toBe('Allocated to refund credit');
});
it('does not infer a booking-specific transfer from a pooled wallet claim',()=>{
 const claim:ProtectedReceiptEvent={event_name:'Claimed',block_number:'11',tx_hash:'claim',event_args:{recipient:buyer,amount:'10000'}};
 expect(protectedOutcome(buyer,'10000',true,3,[settlement,claim])).toBe('Allocated to refund credit');
});
