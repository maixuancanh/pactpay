import {nativeAtomicAccountVerifier} from '../server/auth/atomic-native-reader.ts';
import {compactRuntime} from '../server/auth/atomic-account.ts';
import {writeFileSync} from 'node:fs';
const owner='0x9c45230c3aa792798ae3e9f74ecdcfd096eddd53';
const p=await nativeAtomicAccountVerifier('wss://test-node-v3.portaldot.dev',420420777)('0xbbb5bf2d025b7e2853cd0e78c2d408b115470f12',owner);
const output={checkedAt:new Date().toISOString(),mode:'read-only finalized compact registration verifier; no registration mutation',...p,codeMatches:p.runtime.toLowerCase()===compactRuntime(owner)};
writeFileSync('evidence/compact-registration-verifier.json',JSON.stringify(output,null,2));console.log(JSON.stringify({...output,runtime:output.runtime.length/2-1}));if(!output.codeMatches)process.exitCode=1;
