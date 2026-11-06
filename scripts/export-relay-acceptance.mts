import {connectNativeReadApi} from '../server/sponsorship/native-driver.ts';
import {readFile,writeFile} from 'node:fs/promises';
import {keccak256,type Address} from 'viem';
import {NativeRelayDriver} from '../server/sponsorship/native-driver.ts';
import {verifyAcceptanceAction} from '../server/sponsorship/acceptance.ts';
const [inputFile,policyFile,outputFile]=process.argv.slice(2);
if(inputFile==='--help'||!inputFile||!policyFile||!outputFile){
 console.log('Read-only: export-relay-acceptance.mts <public-receipts.json> <public-policy.json> <NEW-acceptance.json>');
 console.log('Input executions: [{kind,txHash,blockNumber,owner}]. No key, signature or broadcast is accepted.');
}else{
 const input=JSON.parse(await readFile(inputFile,'utf8')),policy=JSON.parse(await readFile(policyFile,'utf8'));
 if(!Array.isArray(input.executions)||input.executions.length>20)throw Error('Expected at most20 public execution receipts');
 const api=await connectNativeReadApi(process.env.NATIVE_RPC??'wss://test-node-v3.portaldot.dev');
 try{const executions=[];
  for(const e of input.executions){
   if(!/^0x[0-9a-f]{64}$/i.test(e.txHash)||!/^\d+$/.test(e.blockNumber)||!/^0x[0-9a-f]{40}$/i.test(e.owner))throw Error('Invalid public receipt identity');
   const hash=await api.rpc.chain.getBlockHash(e.blockNumber),block=await api.rpc.chain.getBlock(hash),tx=block.block.extrinsics.find(x=>x.hash.toHex().toLowerCase()===e.txHash.toLowerCase());
   if(!tx?.isSigned||tx.method.section!=='revive'||tx.method.method!=='call')throw Error('Expected signed native revive call');
   const compactAccount=tx.method.args[0].toString().toLowerCase() as Address,payerNative=tx.signer.toString(),owner=e.owner.toLowerCase() as Address;
   const driver=new NativeRelayDriver(api,{address:payerNative,sign:async()=>{throw Error('This tool is read-only');}});
   await driver.quote({account:compactAccount,owner});
   const journal={hash:e.txHash.toLowerCase(),nonce:tx.nonce.toNumber(),startBlock:Number(e.blockNumber),blockNumber:e.blockNumber,methodHash:keccak256(tx.method.toHex()),payerNative,compactAccount,owner,callHash:keccak256(tx.method.args[4].toHex())};
   if(e.kind==='rollback'){await driver.verifyRollback(journal,{escrow:policy.escrow,token:policy.token});executions.push({kind:e.kind,journal});continue;}
   const proof=await driver.reconcile(journal);if(proof.status!=='finalized'||!proof.settlementKnown||!proof.calls)throw Error('Receipt or actual fee/storage accounting is not fully verified');
   const payment=verifyAcceptanceAction(e.kind,proof.calls,{account:compactAccount,escrow:policy.escrow,token:policy.token});
   if(payment){const snapshot=await driver.readSnapshot(compactAccount,policy.escrow,payment.quoteId);if(snapshot.share!==payment.approved||snapshot.quote.termsHash!==payment.termsHash)throw Error('Exact share acceptance mismatch');}
   executions.push({kind:e.kind,journal});
  }
  await writeFile(outputFile,JSON.stringify({schema:'pactpay-native-relay-acceptance-v1',verifiedAt:new Date().toISOString(),executions},null,2),{flag:'wx'});
  console.log(`Exported ${executions.length} independently verified public receipts. No signature or transaction was sent.`);
 }finally{await api.disconnect();}
}
