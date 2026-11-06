// Run: node --experimental-transform-types scripts/native-probe.mjs [SS58]
// Read-only runtime queries and deployment dry-run. No signer or broadcast.
import {readFileSync,writeFileSync} from 'node:fs';
import {createNativeAdapter} from '../src/native/adapter.ts';
const address=process.argv[2]||'5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt';
const adapter=await createNativeAdapter();
const evidence={checkedAt:new Date().toISOString(),mode:'read-only native runtime + dry-run',signed:false,broadcast:false,address};
try{
 evidence.identity=await adapter.identity();evidence.health=await adapter.health();evidence.signingBlocked=evidence.health.ageMs>180000||evidence.health.head-evidence.health.finalized>32;
 evidence.account=await adapter.account(address);const artifact=JSON.parse(readFileSync('public/deploy-artifacts/DemoUSD.json','utf8'));
 const prepared=await adapter.prepareDeploy(address,artifact.bytecode,'Deploy PactPay test token');
 const {method,...review}=prepared;
 evidence.tokenDeployment=review;
}catch(e){evidence.error=e.message.split('Failed HTTP Request:')[0].slice(0,400);process.exitCode=1;}finally{
 const json=JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?String(v):v,2);writeFileSync('evidence/native-probe.json',json);console.log(json);await adapter.disconnect();
}
