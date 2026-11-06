import {it,expect} from 'vitest';
import {protectedOutcome,type ProtectedReceiptEvent} from './protected-outcome';
const buyer='0xbuyer',merchant='0xmerchant';
const settlement:ProtectedReceiptEvent={event_name:'Settled',block_number:'10',log_index:1,tx_hash:'settle',event_args:{member:buyer,refund:'10000',payout:'0'}};
it('does not infer a received refund from zero credit or settlement alone',()=>{
 expect(protectedOutcome(buyer,merchant,'10000',true,3,'0',[])).toContain('awaiting verification');
 expect(protectedOutcome(buyer,merchant,'10000',true,3,'10000',[settlement])).toBe('Refund available to receive');
 expect(protectedOutcome(buyer,merchant,'10000',true,3,'0',[settlement])).toContain('awaiting verification');
});
it('requires a verified later claim to the correct recipient for a received refund',()=>{
 const claim:ProtectedReceiptEvent={event_name:'Claimed',block_number:'11',tx_hash:'claim',event_args:{recipient:buyer,amount:'10000'}};
 expect(protectedOutcome(buyer,merchant,'10000',true,3,'0',[settlement,claim])).toBe('Refund received');
 expect(protectedOutcome(buyer,merchant,'10000',true,3,'0',[settlement,{...claim,event_args:{recipient:merchant,amount:'10000'}}])).toContain('awaiting verification');
 expect(protectedOutcome(buyer,merchant,'10000',true,3,'0',[settlement,{...claim,block_number:'9'}])).toContain('awaiting verification');
});
