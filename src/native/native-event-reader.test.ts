import {it,expect} from 'vitest';
import {decodeNativeEvents} from './native-event-reader';
import fixture from './fixtures/v3-transaction.json';
const found=fixture.found!;
it('decodes metadata-named revive events only after successful dispatch',()=>{
 const events=found.events.map(event=>({event,phase:0}));
 const rows=decodeNativeEvents(events as any,[{hash:found.hash}],BigInt(found.block),'0x'+'aa'.repeat(32),'0x7c6b401e925d36305e96c3f5472d2bad67a6cc65');
 expect(rows.map(x=>x.event)).toContain('QuoteCreated');expect(rows).toHaveLength(3);
 expect(decodeNativeEvents(events.filter(x=>x.event.method!=='ExtrinsicSuccess') as any,[{hash:found.hash}],1n,'0xaa','0x7c6b401e925d36305e96c3f5472d2bad67a6cc65')).toHaveLength(0);
 expect(decodeNativeEvents(events as any,[{hash:found.hash}],1n,'0xaa','0x'+'11'.repeat(20))).toHaveLength(0);
});
