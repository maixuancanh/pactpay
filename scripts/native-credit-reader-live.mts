import {nativeCreditReader} from '../server/indexer/native-reader.ts';
import {writeFileSync} from 'node:fs';
const read=nativeCreditReader('wss://test-node-v3.portaldot.dev',420420777);
const snapshot=await read('0x7c6b401e925d36305e96c3f5472d2bad67a6cc65','0x0906bc4af89ebe2030e20acc167bbce7b85c409cef105e8b3af1c5126a075485',['0x9e9c796039a48295676265b2e2d62fb2782f56a0']);
writeFileSync('evidence/native-credit-reader-live.json',JSON.stringify({checkedAt:new Date().toISOString(),mode:'live read-only existing deployment; no signatures/writes',snapshot},null,2));console.log(JSON.stringify({source:snapshot.source,block:snapshot.blockNumber,state:snapshot.state,credits:snapshot.credits}));
