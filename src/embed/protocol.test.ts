import {describe,it,expect} from 'vitest';
import {validateEmbedMessage,checkoutMessage} from './protocol';
describe('checkout embed boundary',()=>{
const source={} as Window;
const event=(data:unknown,origin='https://merchant.example',sender=source)=>({data,origin,source:sender});
 it('binds exact origin, source and nonce',()=>{const data=checkoutMessage('abc','pending','s1');expect(validateEmbedMessage(event(data),{origin:'https://merchant.example',source,nonce:'abc',sessionId:'s1'})).toBe(true);expect(validateEmbedMessage(event(data,'https://evil.example'),{origin:'https://merchant.example',source,nonce:'abc',sessionId:'s1'})).toBe(false);expect(validateEmbedMessage(event(data),{origin:'https://merchant.example',source:{},nonce:'wrong',sessionId:'s1'})).toBe(false);});
 it('rejects money instructions and unknown statuses',()=>{expect(validateEmbedMessage(event({type:'pactpay.checkout',nonce:'abc',sessionId:'s1',status:'confirmed',amount:'1'}),{origin:'https://merchant.example',source,nonce:'abc',sessionId:'s1'})).toBe(false);});
});
