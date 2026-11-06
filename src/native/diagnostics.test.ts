import {it,expect} from 'vitest';
import {diagnostics} from './diagnostics';
it('includes validated runtime/action/block and only opted-in transaction hashes',()=>{
 const input={error:'rpc timeout',version:'v',actionCode:'contribute',runtimeVersion:3002,blockNumber:'123',transactionHash:'0x'+'44'.repeat(32)};
 expect(diagnostics(input)).toMatchObject({actionCode:'contribute',runtimeVersion:3002,blockNumber:'123'});
 expect(diagnostics(input)).not.toHaveProperty('transactionHash');
 expect(diagnostics(input,true)).toHaveProperty('transactionHash',input.transactionHash);
 expect(diagnostics({...input,actionCode:'private payload',blockNumber:'bad'})).not.toHaveProperty('actionCode');
});
it('exports only approved fields and never raw error payloads',()=>{const input={error:'Failed fetch https://secret/?apiKey=hidden privateKey seed words',version:'0.1.0',contract:'0x'+'11'.repeat(20),quoteId:'0x'+'22'.repeat(32),storage:'secret'};const value=diagnostics(input);expect(value.errorCode).toBe('RPC_UNAVAILABLE');expect(JSON.stringify(value)).not.toMatch(/hidden|privateKey|seed|secret|contract|quoteId/);expect(diagnostics(input,true)).toHaveProperty('contract');});
