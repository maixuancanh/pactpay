import {NativeRelayDriver} from '../server/sponsorship/native-driver.ts';
import {writeFileSync} from 'node:fs';
const driver=await NativeRelayDriver.connect('wss://test-node-v3.portaldot.dev',{address:'5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt',sign:async()=>{throw Error('Read-only probe forbids signing');}});
try{const result=await driver.quote({account:'0xbbb5bf2d025b7e2853cd0e78c2d408b115470f12',owner:'0x9c45230c3aa792798ae3e9f74ecdcfd096eddd53'});const evidence={checkedAt:new Date().toISOString(),mode:'read-only native relayer identity/runtime/nonce probe, no signer key or broadcast',...result};writeFileSync('evidence/native-relay-readonly.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}finally{await driver.disconnect();}
