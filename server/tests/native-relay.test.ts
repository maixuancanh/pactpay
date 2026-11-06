import {relayExecution} from '../sponsorship/compact-codec.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeReceiptCosts,NativeRelayDriver} from '../sponsorship/native-driver.js';
import {keccak256,type Hex} from 'viem';
function event(section:string,method:string,fields:Record<string,any>){return {section,method,meta:{fields:Object.keys(fields).map(name=>({name:{unwrapOr:()=>({toString:()=>name})}}))},data:Object.values(fields).map(value=>({toJSON:()=>value,toString:()=>String(value)}))};}
test('native cost accounting proves storage transfers against matching Revive holds, never guesses missing costs',()=>{
 const fee=event('transactionPayment','TransactionFeePaid',{who:'payer',actual_fee:'3',tip:'0'});
 assert.deepEqual(nativeReceiptCosts([fee,event('balances','Transfer',{from:'payer',to:'deposit',amount:'4'}),event('balances','Held',{reason:{revive:'StorageDeposit'},who:'deposit',amount:'4'})],'payer'),{actualFee:'3',actualStorage:'4',settlementKnown:true});
 assert.equal(nativeReceiptCosts([fee,event('balances','Transfer',{from:'payer',to:'unidentified',amount:'4'})],'payer').settlementKnown,false);
 assert.equal(nativeReceiptCosts([],'payer').settlementKnown,false);
 assert.equal(nativeReceiptCosts([fee],'payer').actualStorage,'0');
});
test('native recovery checks exact outer call hash, account and payer before trusting finalized success',async()=>{
 const hash=('0x'+'11'.repeat(32)) as Hex,account=('0x'+'22'.repeat(20)) as Hex,data=relayExecution({account,owner:account,relayer:account,chainId:420420777,nonce:'0',deadline:'2000000000',maxFee:'1',maxStorage:'1',calls:[{target:account,data:'0x12345678'}],signature:('0x'+'11'.repeat(32)+'22'.repeat(32)+'1b') as Hex}),method='0x11112222' as Hex;
 const tx:any={hash:{toHex:()=>hash},isSigned:true,signer:{toString:()=> 'payer'},method:{section:'revive',method:'call',toHex:()=>method,args:[{toString:()=>account},{toString:()=> '0'},null,null,{toHex:()=>data}]}};
 const records=[event('system','ExtrinsicSuccess',{}),event('transactionPayment','TransactionFeePaid',{who:'payer',actual_fee:'3',tip:'0'})].map(e=>({phase:{isApplyExtrinsic:true,asApplyExtrinsic:{toNumber:()=>0}},event:e}));
 const api:any={rpc:{chain:{getFinalizedHead:async()=>hash,getHeader:async()=>({number:{toNumber:()=>2}}),getBlockHash:async()=>({toHex:()=>hash}),getBlock:async()=>({block:{extrinsics:[tx]}})}},at:async()=>({query:{system:{events:async()=>records}}})};

 const driver=new NativeRelayDriver(api,{address:'payer',sign:async()=>{throw Error('Read-only test');}});(driver as any).context=async()=>({});
 const journal={hash,nonce:1,startBlock:2,methodHash:keccak256(method),payerNative:'payer',compactAccount:account,owner:account,callHash:keccak256(data)};
 assert.equal((await driver.reconcile(journal)).status,'finalized');api.rpc.chain.getHeader=async()=>({number:{toNumber:()=>5000}});assert.equal((await driver.reconcile(journal)).status,'unknown');assert.equal((await driver.reconcile({...journal,blockNumber:'2'})).status,'finalized');api.rpc.chain.getHeader=async()=>({number:{toNumber:()=>2}});tx.method.args[0]={toString:()=> '0x'+'33'.repeat(20)};await assert.rejects(driver.reconcile(journal),/receipt_call_mismatch/);
});
