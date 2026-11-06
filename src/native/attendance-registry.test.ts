import {it,expect} from 'vitest';
import {mergeAttendance} from './attendance-registry';
const a:any={statement:{genesis:'g',contract:'c',quoteId:'q',attendee:'0x'+'11'.repeat(32),nonce:'n'},signature:'s'};
it('deduplicates exact repeats and rejects conflicting statements for a nonce atomically',()=>{
 expect(mergeAttendance([a],[a])).toHaveLength(1);
 expect(()=>mergeAttendance([a],[{...a,signature:'other'}])).toThrow(/nonce/i);
 expect(mergeAttendance([a],[{...a,statement:{...a.statement,nonce:'next'}}])).toHaveLength(2);
 expect(()=>mergeAttendance([],Array(51).fill(a))).toThrow(/50/);
});
