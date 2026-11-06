import {describe,it,expect} from 'vitest';
import {parseAmount,splitEqual,validateDraft,memberProgress,sanitizeTemplate} from './model';
describe('commerce intent safeguards',()=>{
 it('uses exact integer units and deterministic remainder',()=>{expect(parseAmount('0.01',2)).toBe('1');expect(splitEqual('1',3)).toEqual(['1','0','0']);expect(()=>parseAmount('1,00',2)).toThrow();expect(()=>parseAmount('0.001',2)).toThrow();});
 it('rejects stale consent and six-person rooms',()=>{expect(validateDraft({title:'Trip',total:'100',members:6,deadline:'2099-01-01T00:00'})).toContain('1–5');});
 it('does not turn server funding into finality',()=>{expect(memberProgress({acceptedRevision:1,funded:true},1)).toBe('Accepted · awaiting verified payment');expect(memberProgress({acceptedRevision:0},1)).toBe('Needs to accept updated terms');});
 it('templates discard old payment and consent fields',()=>{expect(sanitizeTemplate({title:'Trip',terms:'Terms',sharePolicy:'equal',durationMinutes:60,quoteId:'old',txHash:'secret',acceptances:['old']})).toEqual({title:'Trip',terms:'Terms',sharePolicy:'equal',durationMinutes:60});});
});
