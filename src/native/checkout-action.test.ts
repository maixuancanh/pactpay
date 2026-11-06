import {expect,it} from 'vitest';
import {checkoutAction,type CheckoutInput} from './checkout-action';
const base: CheckoutInput = {connected:true,mapped:true,fresh:true,pending:false,state:1,now:1n,funding:10n,capture:20n,share:10n,contributed:0n,credit:0n,balance:10n,allowance:0n,merchant:false};
it('prioritizes unknown pending transactions and wallet authority before payment',()=>{
 expect(checkoutAction({...base,pending:true,connected:false}).action).toBe('recover');
 expect(checkoutAction({...base,connected:false}).action).toBe('connect');
 expect(checkoutAction({...base,fresh:false,credit:10n}).action).toBe('refresh');
});
it('requires separate approval and contribution and handles insufficient balance',()=>{
 expect(checkoutAction(base).action).toBe('approve');
 expect(checkoutAction({...base,allowance:10n}).action).toBe('contribute');
 expect(checkoutAction({...base,balance:9n}).enabled).toBe(false);
 expect(checkoutAction({...base,contributed:10n}).enabled).toBe(false);
});
it('handles deadline, merchant capture, claim and incomplete terminal evidence',()=>{
 expect(checkoutAction({...base,now:10n}).action).toBe('expire');
 expect(checkoutAction({...base,state:2,merchant:true}).action).toBe('capture');
 expect(checkoutAction({...base,state:2}).enabled).toBe(false);
 expect(checkoutAction({...base,state:4,credit:10n}).action).toBe('claim');
 expect(checkoutAction({...base,state:3,credit:0n}).reason).toMatch(/does not prove/);
});
