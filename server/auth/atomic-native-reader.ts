import {compactStripLength} from '@polkadot/util';
import {ApiPromise,WsProvider} from '@polkadot/api';
import {decodeFunctionResult,encodeFunctionData,parseAbi,toHex} from 'viem';
import {requireThat} from '../lib.js';
import {V3_GENESIS} from '../indexer/native-reader.js';
import type {AtomicAccountVerifier} from './atomic-account.js';
const abi=parseAbi(['function owner() view returns(address)']);
/** Read-only finalized native RPC. Contains no signer, transaction builder or submission path. */
export function nativeAtomicAccountVerifier(endpoint:string,chainId:number):AtomicAccountVerifier{
 return async(account,owner)=>{
  const provider=new WsProvider(endpoint,false);let api:ApiPromise|undefined;
  const operation=(async()=>{
   await provider.connect();api=await ApiPromise.create({provider,noInitWarn:true});
   requireThat(api.genesisHash.toHex()===V3_GENESIS,'atomic_genesis_mismatch',undefined,503);
   requireThat(Number((api.consts as any).revive.chainId.toString())===chainId,'atomic_chain_mismatch',undefined,503);
   const head=await api.rpc.chain.getFinalizedHead(),at:any=await api.at(head),header=await api.rpc.chain.getHeader(head);
   const origin=(await at.call.reviveApi.accountId(owner)).toString();
   requireThat((await at.call.reviveApi.address(origin)).toString().toLowerCase()===owner,'atomic_inverse_mapping_mismatch',undefined,503);
   const [code,result]=await Promise.all([at.call.reviveApi.code(account),at.call.reviveApi.call(origin,account,0,null,null,encodeFunctionData({abi,functionName:'owner'}))]);
   requireThat(result.result?.isOk,'atomic_owner_read_failed',undefined,503);
   const ok=result.result.asOk,ret=ok.result??ok;
   requireThat(ret.flags&&BigInt(ret.flags.bits?.toString()??ret.flags.toString())===0n,'atomic_owner_read_reverted',undefined,503);
   // Bytes.toU8a(true) strips its SCALE compact length; toHex() may retain it on this runtime.
   const runtime=toHex(compactStripLength(code.toU8a(true))[1]);
   return {accountAddress:account,ownerAddress:decodeFunctionResult({abi,functionName:'owner',data:ret.data.toHex()}),chainId,genesis:api.genesisHash.toHex(),blockHash:head.toHex(),blockNumber:header.number.toString(),finality:'finalized' as const,runtime};
  })();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Atomic account RPC verification timeout')),20000);})]);}
  finally{clearTimeout(timer);if(api)await api.disconnect();else await provider.disconnect();}
 };
}
