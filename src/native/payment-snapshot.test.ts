import {it,expect} from 'vitest';
import {claimKindFromEvents} from './payment-snapshot';
it('requires the exact recipient, quote and amount, deduplicating receipt events',()=>{
 const event={event:'Claimed',args:{quoteId:'0xid',recipient:'0xactor',amount:10n},transactionHash:'0xtx',logIndex:1,receiptStatus:'success'};
 expect(claimKindFromEvents([event,event],3,'0xid','0xactor','0xactor',10n)).toBe('merchant-payout');
 expect(claimKindFromEvents([event],4,'0xid','0xactor','0xother',10n)).toBe('contributor-refund');
 expect(claimKindFromEvents([event],3,'0xid','0xactor','0xactor',11n)).toBe('unknown');
 expect(claimKindFromEvents([event],3,'0xwrong','0xactor','0xactor',10n)).toBe('unknown');
 expect(claimKindFromEvents([{...event,receiptStatus:'failed'}],3,'0xid','0xactor','0xactor',10n)).toBe('unknown');
});
