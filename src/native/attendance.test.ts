import {it,expect} from 'vitest';
import {cryptoWaitReady,sr25519PairFromSeed,sr25519Sign,encodeAddress} from '@polkadot/util-crypto';
import {u8aToHex} from '@polkadot/util';
import {attendanceBytes,verifyAttendance,type AttendanceStatement} from './attendance';
it('binds a native signature to its chain, terms, member and booking',async()=>{
 await cryptoWaitReady();const pair=sr25519PairFromSeed(new Uint8Array(32).fill(9));
 const s:AttendanceStatement={version:1,domain:'PactPay.Attendance',genesis:'0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd',contract:'0x'+'11'.repeat(20),quoteId:'0x'+'22'.repeat(32),termsHash:'0x'+'33'.repeat(32),attendee:encodeAddress(pair.publicKey),statement:'I confirm I attended this booking',issuedAt:new Date().toISOString(),nonce:'0x'+'44'.repeat(16)};
 const signed={statement:s,signature:u8aToHex(sr25519Sign(attendanceBytes(s),pair))};
 expect(verifyAttendance(signed,s)).toBe(true);
 expect(()=>verifyAttendance({...signed,statement:{...s,quoteId:'0x'+'55'.repeat(32)}},s)).toThrow();
 expect(()=>verifyAttendance({...signed,signature:'0x00'},s)).toThrow();
 expect(()=>verifyAttendance(signed,{...s,attendee:encodeAddress(new Uint8Array(32).fill(1))})).toThrow();
});
