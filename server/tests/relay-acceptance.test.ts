import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,encodeFunctionResult,encodeErrorResult,decodeFunctionData,parseAbi,type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {relayPlannerAbi} from '../sponsorship/compact-planner.js';
import {relayAuthorization,relayExecution} from '../sponsorship/compact-codec.js';
import {verifyNativeRollback} from '../sponsorship/rollback.js';
import {verifyAcceptanceAction} from '../sponsorship/acceptance.js';
const account=('0x'+'11'.repeat(20)) as Address,escrow=('0x'+'22'.repeat(20)) as Address,token=('0x'+'33'.repeat(20)) as Address,hash=('0x'+'44'.repeat(32)) as Hex;
test('V3 acceptance rejects relabeled or unrelated successful calls and requires the claimed atomic action',()=>{
 const approve={target:token,data:encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns(bool)']),functionName:'approve',args:[escrow,5n]})},contribute={target:escrow,data:encodeFunctionData({abi:parseAbi(['function contribute(bytes32,bytes32)']),functionName:'contribute',args:[hash,hash]})};
 const result=verifyAcceptanceAction('payment',[approve,contribute],{account,escrow,token});assert.equal(result?.approved,5n);assert.equal(result?.quoteId,hash);assert.throws(()=>verifyAcceptanceAction('refund',[approve,contribute],{account,escrow,token}),/action_mismatch/);assert.throws(()=>verifyAcceptanceAction('payment',[{...approve,target:account},contribute],{account,escrow,token}),/target_mismatch/);
 const claim={target:escrow,data:encodeFunctionData({abi:parseAbi(['function claim(bytes32)']),functionName:'claim',args:[hash]})};assert.throws(()=>verifyAcceptanceAction('merchant-payout',[claim],{account,escrow,token}),/action_mismatch/);
});
test('rollback acceptance verifies restored nonce/allowance/contribution and the dependent revert at parent state',async()=>{
 const owner=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),relayer=('0x'+'77'.repeat(20)) as Address,wrong=('0x'+'88'.repeat(32)) as Hex,correct=('0x'+'99'.repeat(32)) as Hex,approval=parseAbi(['function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)']);
 const r={account,owner:owner.address,relayer,chainId:420420777 as const,nonce:'0',deadline:'2000000000',maxFee:'1',maxStorage:'1',calls:[{target:token,data:encodeFunctionData({abi:approval,functionName:'approve',args:[escrow,5n]})},{target:escrow,data:encodeFunctionData({abi:relayPlannerAbi,functionName:'contribute',args:[hash,wrong]})}]};const raw=relayExecution({...r,signature:await owner.signTypedData(relayAuthorization(r))});
 const quote={merchant:relayer,token,nonce:1n,termsHash:correct,membersHash:hash,sharesHash:hash,total:5n,fundingDeadline:1900000000n,captureDeadline:1950000000n};let changed=false,failureName='ContractReverted';
 const at=(after:boolean)=>({query:{system:{events:async()=>[{phase:{isApplyExtrinsic:true,asApplyExtrinsic:{toNumber:()=>0}},event:{section:'system',method:'ExtrinsicFailed',data:[{isModule:true,asModule:{}}]}}]},timestamp:{now:async()=>({toString:()=> '1800000000000'})}},call:{reviveApi:{address:async()=>({toString:()=>relayer}),getStorage:async()=>({isOk:true,asOk:{isNone:true}}),call:async(_origin:any,contract:any,_value:any,_gas:any,_storage:any,data:Hex)=>{
  if(contract===account)return {result:{isOk:true,asOk:{flags:{bits:1},data:{toHex:()=>encodeErrorResult({abi:relayPlannerAbi,errorName:'TermsMismatch'})}}},weightRequired:{refTime:10,proofSize:0}};
  const abi=contract===token?approval:relayPlannerAbi,name=decodeFunctionData({abi,data}).functionName;const result=name==='allowance'?(after&&changed?1n:0n):name==='shares'?5n:name==='contributions'?0n:[quote,1,0n,[account]];
  return {result:{isOk:true,asOk:{flags:{bits:0},data:{toHex:()=>encodeFunctionResult({abi,functionName:name!,result:result as any})}}}};
 }}}});
 const tx={hash:{toHex:()=>hash},method:{args:[null,null,{refTime:100,proofSize:0},null,{toHex:()=>raw}]}},api={registry:{findMetaError:()=>({section:'revive',name:failureName})},rpc:{chain:{getBlockHash:async(n:number)=>({n,toHex:()=>hash}),getBlock:async()=>({block:{extrinsics:[tx]}})}},at:async(h:any)=>at(h.n===2)},driver={reconcile:async()=>({status:'failed',settlementKnown:true,blockNumber:'2'})},journal={hash,nonce:0,startBlock:2,blockNumber:'2',methodHash:hash,payerNative:'payer',compactAccount:account,owner:owner.address,callHash:hash};
 assert.equal((await verifyNativeRollback(api,driver,journal,{escrow,token})).verified,true);failureName='StorageDepositNotEnoughFunds';await assert.rejects(verifyNativeRollback(api,driver,journal,{escrow,token}),/contract_revert_required/);failureName='ContractReverted';changed=true;await assert.rejects(verifyNativeRollback(api,driver,journal,{escrow,token}),/state_not_restored/);
});
