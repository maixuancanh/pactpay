import {signatureVerify,decodeAddress} from '@polkadot/util-crypto';
import {u8aWrapBytes,u8aEq} from '@polkadot/util';
export const ATTENDANCE_GENESIS='0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd';
export type AttendanceStatement={version:1;domain:'PactPay.Attendance';genesis:string;contract:string;quoteId:string;termsHash:string;attendee:string;statement:'I confirm I attended this booking';issuedAt:string;nonce:string};
export type SignedAttendance={statement:AttendanceStatement;signature:string};
export function attendanceBytes(s:AttendanceStatement){
 if(!s||s.version!==1||s.domain!=='PactPay.Attendance'||s.genesis!==ATTENDANCE_GENESIS||!/^0x[0-9a-f]{40}$/i.test(s.contract)||!/^0x[0-9a-f]{64}$/i.test(s.quoteId)||!/^0x[0-9a-f]{64}$/i.test(s.termsHash)||s.statement!=='I confirm I attended this booking'||!/^0x[0-9a-f]{32}$/i.test(s.nonce)||typeof s.issuedAt!=='string'||!Number.isFinite(Date.parse(s.issuedAt))||decodeAddress(s.attendee).length!==32)throw Error('Invalid attendance statement');
 if(Object.keys(s).some(k=>!['version','domain','genesis','contract','quoteId','termsHash','attendee','statement','issuedAt','nonce'].includes(k)))throw Error('Unexpected attendance fields');
 const canonical={version:s.version,domain:s.domain,genesis:s.genesis,contract:s.contract.toLowerCase(),quoteId:s.quoteId.toLowerCase(),termsHash:s.termsHash.toLowerCase(),attendee:s.attendee,statement:s.statement,issuedAt:s.issuedAt,nonce:s.nonce};
 return u8aWrapBytes(new TextEncoder().encode(JSON.stringify(canonical)));
}
export function verifyAttendance(value:SignedAttendance,expected:Pick<AttendanceStatement,'genesis'|'contract'|'quoteId'|'termsHash'|'attendee'>){
 const s=value?.statement;
 for(const key of ['genesis','contract','quoteId','termsHash'] as const)if(s?.[key]?.toLowerCase()!==expected[key].toLowerCase())throw Error('Attendance belongs to different booking or terms');
 if(!u8aEq(decodeAddress(s.attendee),decodeAddress(expected.attendee)))throw Error('Different attendee');
 if(!/^0x[0-9a-f]{128,132}$/i.test(value.signature)||!signatureVerify(attendanceBytes(s),value.signature,s.attendee).isValid)throw Error('Attendance signature is invalid');
 return true;
}
