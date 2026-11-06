import {expect,it} from 'vitest';
import {verificationNonce} from './verification-recovery';
it('pins retries to an unused original nonce and blocks unknown broadcasts',()=>{
 expect(verificationNonce(0,0,null,true)).toBe(0);
 expect(verificationNonce(3,3,'3',true)).toBe(3);
 expect(verificationNonce(3,3,null,false)).toBe(3);
 expect(()=>verificationNonce(0,1,'0',true)).toThrow('pending');
 expect(()=>verificationNonce(1,1,'0',true)).toThrow('may have been sent');
 expect(()=>verificationNonce(1,1,null,true)).toThrow('may have been sent');
 expect(()=>verificationNonce(1,1,'bad',true)).toThrow();
});
