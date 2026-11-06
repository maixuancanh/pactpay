import {describe,it,expect,vi} from 'vitest';
import {readDryRun,assertNativeIdentity,finalizedDispatch,pending,nativeHistory,recordNativeHistory,NativeAdapter,NATIVE_GENESIS,NATIVE_PENDING_KEY} from './adapter';
const address='5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt';
vi.mock('@polkadot/extension-dapp',()=>({web3Enable:async()=>[{}],web3Accounts:async()=>[{address,meta:{source:'polkadot-js'}}],web3FromAddress:async()=>({signer:{}})}));
describe('native adapter guards',()=>{
 it('explains runtime storage deposit insufficiency without suggesting redeployment',()=>{
 const registry={findMetaError:()=>({section:'revive',name:'StorageDepositNotEnoughFunds',docs:[]})};
 expect(()=>readDryRun({result:{isErr:true,asErr:{isModule:true,asModule:{}}}},registry)).toThrow(/Insufficient native balance for contract storage deposit/);
 });
 it('rejects a same-name network with a different genesis',()=>{expect(()=>assertNativeIdentity('0x123',420420777,14,'portaldot-v3',3002)).toThrow(/network/i)});
 it('rejects dispatch errors and EVM revert flags before a signing review',()=>{
  expect(()=>readDryRun({result:{isErr:true,asErr:{toString:()=> 'Denied'}}})).toThrow(/Denied/);
  expect(()=>readDryRun({result:{isErr:false,asOk:{flags:{bits:1}}}})).toThrow(/revert/i);
 });
 it('uses max storage charge, exact bigint weight and predicted deployment',()=>{
  const r=readDryRun({weightRequired:{refTime:'100',proofSize:'20'},storageDeposit:{isCharge:true,asCharge:'5'},maxStorageDeposit:{isCharge:true,asCharge:'9'},gasConsumed:'0',result:{isErr:false,asOk:{result:{flags:{bits:0}},addr:'0x'+'11'.repeat(20)}}});
  expect(r.storageDeposit).toBe(9n);expect(r.weight.refTime).toBe(120n);expect(r.predictedContract).toBe('0x'+'11'.repeat(20));
 });
 it('requires explicit successful system dispatch event at finality',()=>{
  expect(()=>finalizedDispatch([{event:{section:'system',method:'ExtrinsicFailed',data:['failure']}}])).toThrow(/failure/);
  expect(()=>finalizedDispatch([])).toThrow(/success/i);
  expect(finalizedDispatch([{event:{section:'system',method:'ExtrinsicSuccess'}}])).toBe(true);
 });
 it('does not treat corrupt pending records as absence',()=>{expect(()=>pending({getItem:()=>'{'} as any)).toThrow(/saved/i)});
});
const storage=()=>{const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}}};
const prepared=()=>({id:'intent',address,label:'Contribute',kind:'call' as const,fee:10n,storageDeposit:20n,weight:{refTime:100n,proofSize:5n},method:'0x500100' as const,nonce:0,createdAt:Date.now(),startBlock:1,specVersion:3002,genesis:NATIVE_GENESIS});
const testLocks={busy:false,async request<T>(_name:string,_options:{ifAvailable:true},callback:(lock:unknown|null)=>Promise<T>):Promise<T>{if(this.busy)return callback(null);this.busy=true;try{return await callback({});}finally{this.busy=false;}}};
function fake(api:any){const a=new NativeAdapter(api,testLocks);vi.spyOn(a,'identity').mockResolvedValue({chain:'PortaldotV3 Test',genesis:NATIVE_GENESIS,specVersion:3002,decimals:14});vi.spyOn(a,'health').mockResolvedValue({timestamp:Date.now(),ageMs:0,head:1,finalized:1});vi.spyOn(a,'account').mockResolvedValue({address,h160:'0x'+'11'.repeat(20) as any,mapped:true,balance:100n,frozen:0n,spendable:100n});return a;}
describe('native wallet lifecycle',()=>{
 it('exports bounded activity without signed bytes or transaction payload',()=>{const s=storage();for(let i=0;i<55;i++)recordNativeHistory(s,{id:String(i),address,label:'Payment',status:'signed',hash:'0xabc',signed:'secret-signed-payload',method:'0x1234',nonce:0,genesis:NATIVE_GENESIS,startBlock:0} as any);const rows=nativeHistory(s);expect(rows).toHaveLength(50);expect(rows[0].id).toBe('54');expect(JSON.stringify(rows)).not.toMatch(/secret-signed|method/);recordNativeHistory(s,{id:'54',address,label:'Payment',status:'finalized',nonce:0,method:'0x00',genesis:NATIVE_GENESIS,startBlock:0} as any);expect(nativeHistory(s)).toHaveLength(50);expect(nativeHistory(s)[0].status).toBe('finalized')});
 it('blocks stale chain before extension signing or creating a pending intent',async()=>{const s=storage(),a=fake({});vi.spyOn(a,'health').mockResolvedValue({timestamp:1,ageMs:999999,head:1,finalized:1});await expect(a.signAndSend(prepared(),s)).rejects.toThrow(/stale/);expect(s.getItem(NATIVE_PENDING_KEY)).toBe(null)});
 it('never replaces an unresolved intent',async()=>{const s=storage();s.setItem(NATIVE_PENDING_KEY,JSON.stringify({...prepared(),fee:'10',storageDeposit:'20',weight:{refTime:'100',proofSize:'5'},status:'unknown'}));await expect(fake({}).signAndSend(prepared(),s)).rejects.toThrow(/Reconcile/)});
 it('rejects changed nonce before opening the signer',async()=>{const s=storage(),a=fake({rpc:{system:{accountNextIndex:async()=>1}}});await expect(a.signAndSend(prepared(),s)).rejects.toThrow(/nonce changed/);expect(pending(s)).toBe(null)});
 it('persists intent before signing and signed bytes before broadcast; lost broadcast reply stays blocked',async()=>{
  const s=storage(),tx={signAsync:async()=>{expect(pending(s)?.status).toBe('awaiting-signature')},toHex:()=> '0x1234',hash:{toHex:()=> '0x'+'11'.repeat(32)}};
  const a=fake({registry:{createType:(type:string,data:string)=>{expect(type).toBe('Call');expect(data).toBe(prepared().method);return {method:data}}},tx:(call:any)=>{expect(call.method).toBe(prepared().method);return tx},rpc:{system:{accountNextIndex:async()=>0},author:{submitExtrinsic:async()=>{expect(pending(s)?.signed).toBe('0x1234');throw Error('Lost broadcast response')}}}});
  await expect(a.signAndSend(prepared(),s)).rejects.toThrow(/Lost/);expect(pending(s)?.status).toBe('unknown');expect(nativeHistory(s)[0].status).toBe('unknown');await expect(a.signAndSend(prepared(),s)).rejects.toThrow(/Reconcile/);
 });
 it('clears a rejected signature since no broadcast was made',async()=>{const s=storage(),a=fake({registry:{createType:()=>({})},tx:()=>({signAsync:async()=>{throw Error('Rejected')}}),rpc:{system:{accountNextIndex:async()=>0}}});await expect(a.signAndSend(prepared(),s)).rejects.toThrow(/Rejected/);expect(pending(s)).toBe(null)});
 it('retains finalized results until UI readback is acknowledged, survives a fresh adapter',async()=>{
  const s=storage(),hash='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32);
  s.setItem(NATIVE_PENDING_KEY,JSON.stringify({...prepared(),fee:'10',storageDeposit:'20',weight:{refTime:'100',proofSize:'5'},status:'finalized',hash,blockHash}));
  const a=fake({});expect(await a.recover(s)).toEqual({hash,blockHash,contractAddress:undefined});expect(pending(s)?.status).toBe('finalized');
  expect(()=>a.acknowledge(s,{hash:('0x'+'33'.repeat(32)) as any,blockHash:blockHash as any})).toThrow(/match/i);
  a.acknowledge(s,{hash:hash as any,blockHash:blockHash as any});expect(pending(s)).toBe(null);
 });
 it('recovers exact sender nonce and call from finality without submitting again',async()=>{
  const s=storage();s.setItem(NATIVE_PENDING_KEY,JSON.stringify({id:'r',address,genesis:NATIVE_GENESIS,nonce:0,method:'0x500100',startBlock:1,status:'unknown'}));
  const tx={isSigned:true,signer:{toString:()=>address},nonce:0,method:{toHex:()=> '0x500100'},hash:{toHex:()=> '0xabc'}};
  const events=[{phase:{isApplyExtrinsic:true,asApplyExtrinsic:{toNumber:()=>0}},event:{section:'system',method:'ExtrinsicSuccess'}}];
  const api={rpc:{chain:{getFinalizedHead:async()=> 'final',getHeader:async()=>({number:{toNumber:()=>1}}),getBlockHash:async()=>({toHex:()=> '0xdef'}),getBlock:async()=>({block:{extrinsics:[tx]}})}},at:async()=>({query:{system:{events:async()=>events}}})};
  const result=await fake(api).recover(s);expect(result.hash).toBe('0xabc');expect(pending(s)?.status).toBe('finalized');
 });
 it('a finalized failed dispatch never becomes a successful contract action',async()=>{
  const s=storage();s.setItem(NATIVE_PENDING_KEY,JSON.stringify({id:'r',address,genesis:NATIVE_GENESIS,nonce:0,method:'0x500100',startBlock:1,status:'unknown',hash:'0xabc'}));
  const events=[{phase:{isApplyExtrinsic:true,asApplyExtrinsic:{toNumber:()=>0}},event:{section:'system',method:'ExtrinsicFailed',data:['reverted']}}];
  const api={rpc:{chain:{getFinalizedHead:async()=> 'final',getHeader:async()=>({number:{toNumber:()=>1}}),getBlockHash:async()=>({toHex:()=> '0xdef'}),getBlock:async()=>({block:{extrinsics:[{hash:{toHex:()=> '0xabc'}}]}})}},at:async()=>({query:{system:{events:async()=>events}}})};
  await expect(fake(api).recover(s)).rejects.toThrow(/reverted/);expect(pending(s)).toBe(null);expect(JSON.parse(s.getItem('pactpay.native.last')!).status).toBe('failed');
 });
});

it('keeps the first signing intent when concurrent reviews finish preflight together',async()=>{
 const s=storage();let release!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve});
 const tx={signAsync:async()=>{await hold;throw Error('Rejected by user')},toHex:()=> '0x1234',hash:{toHex:()=> '0x'+'11'.repeat(32)}};
 const api={registry:{createType:()=>({})},tx:()=>tx,rpc:{system:{accountNextIndex:async()=>0}}};
 const a=fake(api),b=fake(api);
 const first=a.signAndSend({...prepared(),id:'first'},s).catch(e=>e);
 // Both adapters enter before either has persisted an intent.
 const second=b.signAndSend({...prepared(),id:'second'},s).catch(e=>e);
 // Give both async preflights and extension import time to finish.
 await vi.waitFor(()=>expect(pending(s)).not.toBe(null));
 const saved=pending(s)?.id;
 release();
 const [one,two]=await Promise.all([first,second]);
 expect(saved).toBe('first');
 expect(one.message).toMatch(/Rejected by user/);
 expect(two.message).toMatch(/Reconcile/);
 expect(b.identity).not.toHaveBeenCalled();
});

it('fails closed without a browser signing lock provider',async()=>{
 const s=storage(),a=new NativeAdapter({} as any,null as any);
 await expect(a.signAndSend(prepared(),s)).rejects.toThrow(/browser.*lock/i);
 expect(pending(s)).toBe(null);
});



 it('reads compact nonce from finalized storage and distinguishes missing slot from read failure',async()=>{
 const result={isOk:true,asOk:{isNone:true}};const getStorage=vi.fn(async()=>result);const a=new NativeAdapter({rpc:{chain:{getFinalizedHead:async()=> 'finalized'}},at:async()=>({call:{reviveApi:{getStorage}}})} as any);
 vi.spyOn(a,'identity').mockResolvedValue({genesis:NATIVE_GENESIS,specVersion:3002,chain:'V3',decimals:14});
 expect(await a.readContractStorage('0x'+'11'.repeat(20) as any,'0x'+'00'.repeat(32) as any)).toBe(0n);
 Object.assign(result,{asOk:{isNone:false,unwrap:()=>({toHex:()=> '0x'+'00'.repeat(31)+'02'})}});expect(await a.readContractStorage('0x'+'11'.repeat(20) as any,'0x'+'00'.repeat(32) as any)).toBe(2n);
 result.isOk=false;await expect(a.readContractStorage('0x'+'11'.repeat(20) as any,'0x'+'00'.repeat(32) as any)).rejects.toThrow(/unavailable/);
 });

describe('native receipt block identity',()=>{
 it('resolves finalized native hashes without EVM block lookup and rejects a fork',async()=>{
  const hash='0x'+'ab'.repeat(32);
  let canonical=hash;
  const chain={getHeader:async(value?:string)=>({number:{toString:()=>value===hash?'7':'9'}}),getFinalizedHead:async()=>'finalized',getBlockHash:async()=>({toHex:()=>canonical})};
  const adapter=fake({rpc:{chain}});
  expect(await adapter.finalizedBlockNumber(hash as any)).toBe('7');
  canonical='0x'+'cd'.repeat(32);
  await expect(adapter.finalizedBlockNumber(hash as any)).rejects.toThrow(/canonical and finalized/);
 });
});
