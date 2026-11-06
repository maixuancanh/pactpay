import {it,expect} from 'vitest';
import {paymentStatus} from './payment-status';
it('requires actor-specific verified claims and fresh state for settlement labels',()=>{
 expect(paymentStatus(3,0n,'unknown',false,true)).toBe('closed-unverified');
 expect(paymentStatus(3,0n,'merchant-payout',false,true)).toBe('payout-verified');
 expect(paymentStatus(4,0n,'contributor-refund',false,true)).toBe('refund-verified');
 expect(paymentStatus(3,1n,'unknown',true,true)).toBe('payout-available');
 expect(paymentStatus(4,1n,'unknown',false,false)).toBe('unknown');
});
