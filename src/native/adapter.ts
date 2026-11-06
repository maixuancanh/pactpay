import {assertNativeBatchProof,type NativeBatchSimulator} from '../payments/native-batch';
import {ApiPromise,WsProvider} from '@polkadot/api';
import {decodeAddress} from '@polkadot/util-crypto';
import {u8aEq} from '@polkadot/util';
import {isAddress,formatUnits,type Address,type Hex} from 'viem';

export const NATIVE_RPC='wss://test-node-v3.portaldot.dev';
export const NATIVE_GENESIS='0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd';
export const NATIVE_PENDING_KEY='pactpay.native.pending:v1';
export type NativeAccount={address:string;name:string;source:string};
export type PreparedNativeTx={id:string;address:string;label:string;kind:'call'|'deploy';fee:bigint;storageDeposit:bigint;weight:{refTime:bigint;proofSize:bigint};predictedContract?:Hex;method:Hex;nonce:number;createdAt:number;startBlock:number;specVersion:number;genesis:string};
export type FinalizedNativeTx={hash:Hex;blockHash:Hex;contractAddress?:Hex};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type NativeLockProvider={request<T>(name:string,options:{ifAvailable:true},callback:(lock:unknown|null)=>Promise<T>):Promise<T>};
type NativeIntent={id:string;address:string;label:string;kind:string;nonce:number;method:Hex;startBlock:number;genesis:string;status:string;hash?:Hex;blockHash?:Hex;signed?:Hex;predictedContract?:Hex};
export type NativeActivity={id:string;address:string;label:string;status:string;hash?:Hex;blockHash?:Hex;createdAt:number;error?:string};
const HISTORY='pactpay.native.history:v1';
export function nativeHistory(storage:Pick<Storage,'getItem'>):NativeActivity[]{try{const raw=JSON.parse(storage.getItem(HISTORY)||'[]');return Array.isArray(raw)?raw.filter(r=>r&&typeof r.id==='string'&&typeof r.label==='string').slice(0,50).map(r=>({id:r.id,address:r.address,label:r.label,status:r.status,hash:r.hash,blockHash:r.blockHash,createdAt:r.createdAt,error:r.error})):[];}catch{return[];}}
export function recordNativeHistory(storage:Store,row:NativeIntent&{error?:string}){const old=nativeHistory(storage),prior=old.find(r=>r.id===row.id);const safe:NativeActivity={id:row.id,address:row.address,label:row.label,status:row.status,hash:row.hash,blockHash:row.blockHash,createdAt:prior?.createdAt||Date.now(),error:row.error?.split('Failed HTTP Request:')[0].slice(0,400)};storage.setItem(HISTORY,JSON.stringify([safe,...old.filter(r=>r.id!==row.id)].slice(0,50)));}
const number=(v:any)=>BigInt(v?.toString?.()??v??0);
const charge=(v:any)=>v?.isCharge?number(v.asCharge):0n;
export function assertNativeIdentity(genesis:string,chainId:number,decimals:number,specName:string,specVersion:number){
 if(genesis!==NATIVE_GENESIS||chainId!==420420777||decimals!==14||specName!=='portaldot-v3'||specVersion!==3002)throw Error('Unsupported native network or runtime. Refresh the verified V3 configuration before signing.');
}
export function readDryRun(r:any,registry?:{findMetaError:(error:any)=>{section:string;name:string;docs:string[]}}){
 if(!r.result||r.result.isErr){const error=r.result?.asErr;if(error?.isModule&&registry){const meta=registry.findMetaError(error.asModule);if(meta.name==='StorageDepositNotEnoughFunds')throw Error('Insufficient native balance for contract storage deposit. This simulation sent no transaction and charged no fee. Executing an existing contract can require additional storage deposit; redeployment is not needed.');throw Error('Native dry-run failed: '+meta.section+'.'+meta.name+' — '+meta.docs.join(' '));}throw Error('Native dry-run failed: '+(error?.toString()||'missing result'));}
 const ok=r.result.asOk,ret=ok.result||ok;
 if(!ret.flags||Number(ret.flags.bits?.toString?.()??ret.flags.bits??ret.flags.toString())!==0)throw Error('Contract dry-run reverted. No wallet request was made.');
 const refTime=number(r.weightRequired?.refTime),proofSize=number(r.weightRequired?.proofSize);
 if(refTime<=0n||proofSize<0n)throw Error('Dry-run did not return valid execution weight.');
 const storageDeposit=charge(r.maxStorageDeposit)>charge(r.storageDeposit)?charge(r.maxStorageDeposit):charge(r.storageDeposit);
 return {weight:{refTime:refTime+refTime/5n,proofSize:proofSize+proofSize/5n},storageDeposit,predictedContract:ok.addr?.toString() as Hex|undefined};
}
export function finalizedDispatch(events:any[]){
 const failed=events.find(x=>x.event.section==='system'&&x.event.method==='ExtrinsicFailed');
 if(failed)throw Error('Finalized transaction failed: '+String(failed.event.data));
 if(!events.some(x=>x.event.section==='system'&&x.event.method==='ExtrinsicSuccess'))throw Error('Finalized transaction has no success dispatch evidence.');
 return true;
}
export function pending(storage:Pick<Storage,'getItem'>):NativeIntent|null{
 try{const raw=storage.getItem(NATIVE_PENDING_KEY);if(!raw)return null;const row=JSON.parse(raw);if(row.genesis!==NATIVE_GENESIS||!row.address||!row.method||!Number.isInteger(row.nonce))throw Error();return row;}catch{throw Error('Saved native transaction could not be read. Inspect wallet history before clearing it.');}
}
const serialize=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x);
export async function connectNativeWallet():Promise<NativeAccount[]>{
 const {web3Enable,web3Accounts}=await import('@polkadot/extension-dapp');
 const ext=await web3Enable('PactPay');if(!ext.length)throw Error('Open Polkadot.js Extension and allow PactPay account access.');
 const accounts=await web3Accounts();return accounts.map(a=>({address:a.address,name:a.meta.name||'Native account',source:a.meta.source}));
}
export async function subscribeNativeAccounts(callback:(accounts:NativeAccount[])=>void){const {web3AccountsSubscribe}=await import('@polkadot/extension-dapp');return web3AccountsSubscribe(accounts=>callback(accounts.map(a=>({address:a.address,name:a.meta.name||'Native account',source:a.meta.source}))));}
export class NativeAdapter{
 private scanned=new Map<string,number>();
 constructor(private api:ApiPromise,private locks:NativeLockProvider|null=globalThis.navigator?.locks??null,private batchSimulator?:NativeBatchSimulator){}
 async identity(){const a=this.api;const [props,version]=await Promise.all([a.rpc.system.properties(),a.rpc.state.getRuntimeVersion()]);const decimals=props.tokenDecimals.unwrapOrDefault()[0]?.toNumber();const genesis=a.genesisHash.toHex(),specVersion=version.specVersion.toNumber();assertNativeIdentity(genesis,Number(a.consts.revive.chainId.toString()),decimals,version.specName.toString(),specVersion);return{chain:await a.rpc.system.chain().then(x=>x.toString()),genesis,specVersion,decimals};}
 async health(){const timestamp=number(await this.api.query.timestamp.now()),head=await this.api.rpc.chain.getHeader(),finalized=await this.api.rpc.chain.getFinalizedHead(),finalizedHeader=await this.api.rpc.chain.getHeader(finalized);return{timestamp:Number(timestamp),ageMs:Date.now()-Number(timestamp),head:head.number.toNumber(),finalized:finalizedHeader.number.toNumber()};}
 async account(address:string){
  const bytes=decodeAddress(address);if(bytes.length!==32)throw Error('Select a valid AccountId32 native wallet.');await this.identity();
  const a=this.api,h160=(await (a.call as any).reviveApi.address(address)).toString() as Address;
  if(!isAddress(h160))throw Error('Runtime returned an invalid contract address mapping.');
  const inverse=await (a.call as any).reviveApi.accountId(h160),original=await (a.query as any).revive.originalAccount(h160);
  const mapped=u8aEq(bytes,decodeAddress(inverse.toString()))&&original.isSome&&u8aEq(bytes,decodeAddress(original.unwrap().toString()));
  const info:any=await a.query.system.account(address),balance=number(info.data.free),frozen=number(info.data.frozen),ed=number(a.consts.balances.existentialDeposit);
  const unavailable=frozen>ed?frozen:ed;
  return {address,h160,mapped,balance,frozen,spendable:balance>unavailable?balance-unavailable:0n};
 }
 async prepareMap(_address:string):Promise<PreparedNativeTx>{throw Error('This verified V3 runtime uses AutoMap. Manual mapping is disabled; ask support if inverse mapping is missing.');}
 async finalizedBlockNumber(hash:Hex){
  await this.identity();
  const chain=this.api.rpc.chain;
  const [header,finalized]=await Promise.all([chain.getHeader(hash),chain.getFinalizedHead().then(head=>chain.getHeader(head))]);
  const blockNumber=BigInt(header.number.toString());
  if(blockNumber>BigInt(finalized.number.toString())||(await chain.getBlockHash(blockNumber.toString())).toHex()!==hash)throw Error('Native receipt block is not canonical and finalized.');
  return blockNumber.toString();
 }
 async readFinalizedCalls(address:string,calls:readonly {to:Address;data:Hex}[]){
  await this.identity();const head=await this.api.rpc.chain.getFinalizedHead(),at=await this.api.at(head),header=await this.api.rpc.chain.getHeader(head);
  const values:Hex[]=[];for(const call of calls){if(!isAddress(call.to)||!/^0x(?:[0-9a-f]{2})*$/i.test(call.data))throw Error('Invalid read call');const result=await (at.call as any).reviveApi.call(address,call.to,0,null,null,call.data);readDryRun(result,this.api.registry);const ok=result.result.asOk,ret=ok.result??ok;values.push(ret.data.toHex());}
  return {values,blockHash:head.toHex(),blockNumber:header.number.toString(),timestamp:Number((await at.query.timestamp.now()).toString())};
 }
 async readContractStorage(dest:Address,slot:Hex):Promise<bigint>{
  if(!isAddress(dest)||!/^0x[0-9a-f]{64}$/i.test(slot))throw Error('Invalid contract storage key');
  await this.identity();const head=await this.api.rpc.chain.getFinalizedHead(),at=await this.api.at(head);
  const result=await (at.call as any).reviveApi.getStorage(dest,slot);
  if(!result.isOk)throw Error('Finalized contract storage is unavailable');
  const value=result.asOk;if(value.isNone)return 0n;
  const raw=value.unwrap().toHex();if(!/^0x[0-9a-f]{64}$/i.test(raw))throw Error('Invalid contract storage word');
  return BigInt(raw);
 }
 async readContractData(address:string,dest:Address,data:Hex):Promise<Hex>{
  const actor=await this.account(address);if(!actor.mapped)throw Error('Reader account mapping is not verified');
  const result=await (this.api.call as any).reviveApi.call(address,dest,0,null,null,data);readDryRun(result,this.api.registry);const ok=result.result.asOk,ret=ok.result||ok;return ret.data.toHex() as Hex;
 }
 async prepareCall(address:string,dest:Address,data:Hex,label:string){
  if(!isAddress(dest)||!/^0x(?:[a-fA-F0-9]{2})*$/.test(data))throw Error('Invalid contract transaction.');
  const actor=await this.account(address);if(!actor.mapped)throw Error('Native account mapping is not verified. No transaction was prepared.');
  const result=await (this.api.call as any).reviveApi.call(address,dest,0,null,null,data);const dry=readDryRun(result,this.api.registry);
  const tx=(this.api.tx as any).revive.call(dest,0,dry.weight,dry.storageDeposit.toString(),data);
  return this.prepare(address,label,'call',tx,dry);
 }
 get supportsAtomicBatch(){return !!this.batchSimulator&&!!(this.api.tx as any).utility?.batchAll;}
 async prepareBatch(address:string,calls:readonly {to:Address;data:Hex}[],label:string):Promise<PreparedNativeTx>{
  if(!this.batchSimulator)throw Error('Atomic batch full-state simulation is unavailable on this runtime. Continue with the clearly labeled sequential wallet steps.');
  if(calls.length<2||calls.length>2||calls.some(c=>!isAddress(c.to)||!/^0x(?:[a-fA-F0-9]{2})+$/.test(c.data)))throw Error('Exactly two valid contract calls required');
  const identity=await this.identity(),actor=await this.account(address);if(!actor.mapped)throw Error('Native account origin mapping is unverified');
  const input={account:address,chainId:420420777,genesis:identity.genesis,specVersion:identity.specVersion,calls};const proof=await this.batchSimulator(input);assertNativeBatchProof(proof,input);
  const batchAll=(this.api.tx as any).utility?.batchAll;if(!batchAll)throw Error('Runtime atomic batchAll is missing');
  const tx=batchAll(proof.calls.map(c=>(this.api.tx as any).revive.call(c.to,0,c.weight,c.storageDeposit.toString(),c.data)));
  const dry={weight:proof.calls.reduce((a,c)=>({refTime:a.refTime+c.weight.refTime,proofSize:a.proofSize+c.weight.proofSize}),{refTime:0n,proofSize:0n}),storageDeposit:proof.calls.reduce((n,c)=>n+c.storageDeposit,0n),predictedContract:undefined};
  return this.prepare(address,label,'call',tx,dry);
 }
 async prepareDeploy(address:string,initCode:Hex,label:string){
  if(!/^0x(?:[a-fA-F0-9]{2})+$/.test(initCode))throw Error('Invalid deployment bytecode.');
  const actor=await this.account(address);if(!actor.mapped)throw Error('Native account mapping is not verified.');
  const result=await (this.api.call as any).reviveApi.instantiate(address,0,null,null,{Upload:initCode},'0x',null);const dry=readDryRun(result,this.api.registry);
  if(!isAddress(dry.predictedContract||''))throw Error('Native deployment dry-run did not return a contract address.');
  const tx=(this.api.tx as any).revive.instantiateWithCode(0,dry.weight,dry.storageDeposit.toString(),initCode,'0x',null);
  return this.prepare(address,label,'deploy',tx,dry);
 }
 private async prepare(address:string,label:string,kind:'call'|'deploy',tx:any,dry:ReturnType<typeof readDryRun>):Promise<PreparedNativeTx>{
  const identity=await this.identity(),info=await tx.paymentInfo(address),fee=number(info.partialFee)*120n/100n;
  const actor=await this.account(address);if(actor.spendable<fee+dry.storageDeposit)throw Error('This step needs '+formatUnits(fee+dry.storageDeposit,14)+' tPOT for fees and storage. Your spendable balance is '+formatUnits(actor.spendable,14)+' tPOT. Add at least '+formatUnits(fee+dry.storageDeposit-actor.spendable,14)+' tPOT, then review again.');
  return {id:crypto.randomUUID(),address,label,kind,...dry,fee,method:tx.method.toHex(),nonce:Number((await this.api.rpc.system.accountNextIndex(address)).toString()),startBlock:(await this.api.rpc.chain.getHeader()).number.toNumber(),createdAt:Date.now(),genesis:identity.genesis,specVersion:identity.specVersion};
 }
 async signAndSend(p:PreparedNativeTx,storage:Store):Promise<FinalizedNativeTx>{
  if(!this.locks)throw Error('Browser signing locks are unavailable. Open PactPay in a supported secure browser before signing.');
  // Web Locks serialize the complete signing lifecycle across same-origin tabs.
  // Never queue a second signature request behind an unresolved first request.
  return this.locks.request('pactpay.native.sign:'+NATIVE_GENESIS,{ifAvailable:true},async lock=>{
   if(!lock)throw Error('Another PactPay tab is signing. Reconcile its transaction before signing another.');
   return this.signAndSendLocked(p,storage);
  });
 }
 private async signAndSendLocked(p:PreparedNativeTx,storage:Store):Promise<FinalizedNativeTx>{
  if(pending(storage))throw Error('Reconcile the saved native transaction before signing another.');
  const i=await this.identity();if(p.genesis!==i.genesis||p.specVersion!==i.specVersion||Date.now()-p.createdAt>300000)throw Error('Transaction review expired. Prepare it again.');
  const health=await this.health();if(health.ageMs>180000||health.ageMs< -60000||health.head-health.finalized>32)throw Error('V3 chain timestamp or finality is stale. Signing is blocked until the network catches up. Your native funds have not been moved.');
  const permitted=await connectNativeWallet();if(!permitted.some(a=>u8aEq(decodeAddress(a.address),decodeAddress(p.address))))throw Error('Selected native account is no longer shared by the extension.');
  const actor=await this.account(p.address);if(!actor.mapped||actor.spendable<p.fee+p.storageDeposit)throw Error('Account mapping or available balance changed. Review again.');
  if(Number((await this.api.rpc.system.accountNextIndex(p.address)).toString())!==p.nonce)throw Error('Native account nonce changed. Prepare a fresh review.');
  // Preflight awaits may overlap another adapter's review. Check again immediately
  // before the synchronous storage write so its unresolved intent cannot be replaced.
  if(pending(storage))throw Error('Reconcile the saved native transaction before signing another.');
  const row:NativeIntent={id:p.id,address:p.address,label:p.label,kind:p.kind,nonce:p.nonce,method:p.method,startBlock:p.startBlock,genesis:p.genesis,status:'awaiting-signature',predictedContract:p.predictedContract};
  storage.setItem(NATIVE_PENDING_KEY,serialize(row));
  recordNativeHistory(storage,row);
  let signed=false;
  try{
   const {web3FromAddress}=await import('@polkadot/extension-dapp');
   const ext=await web3FromAddress(p.address),tx=this.api.tx(this.api.registry.createType('Call',p.method));await tx.signAsync(p.address,{signer:ext.signer,nonce:p.nonce,era:64});
   signed=true;row.signed=tx.toHex();row.hash=tx.hash.toHex();row.status='signed';storage.setItem(NATIVE_PENDING_KEY,serialize(row));
   recordNativeHistory(storage,row);
   const hash=await this.api.rpc.author.submitExtrinsic(row.signed);if(hash.toHex()!==row.hash)throw Error('Broadcast hash differs from saved signed transaction.');row.status='broadcast';storage.setItem(NATIVE_PENDING_KEY,serialize(row));
   recordNativeHistory(storage,row);
   for(let attempt=0;attempt<60;attempt++){const found=await this.findFinalized(row,storage);if(found)return found;await new Promise(r=>setTimeout(r,2000));}
   throw Error('Waiting for native finality. Reconcile the saved transaction; do not resend.');
  }catch(e:any){if(!signed){storage.removeItem(NATIVE_PENDING_KEY);row.status='rejected';}else if(row.status!=='finalized'&&row.status!=='failed'){row.status='unknown';storage.setItem(NATIVE_PENDING_KEY,serialize(row));}recordNativeHistory(storage,{...row,error:String(e.message||e)});throw e;}
 }
 private async findFinalized(row:NativeIntent,storage:Store):Promise<FinalizedNativeTx|null>{
  const head=await this.api.rpc.chain.getFinalizedHead(),header=await this.api.rpc.chain.getHeader(head),end=header.number.toNumber();
  for(let n=end;n>=Math.max(row.startBlock,end-79,(this.scanned.get(row.id)??-1)+1,0);n--){
   const hash=await this.api.rpc.chain.getBlockHash(n),block=await this.api.rpc.chain.getBlock(hash);
   const idx=block.block.extrinsics.findIndex(x=>row.hash?x.hash.toHex()===row.hash:x.isSigned&&u8aEq(decodeAddress(x.signer.toString()),decodeAddress(row.address))&&Number(x.nonce.toString())===row.nonce&&x.method.toHex()===row.method);
   if(idx<0)continue;const at=await this.api.at(hash),events:any=await at.query.system.events();const own=events.filter((e:any)=>e.phase.isApplyExtrinsic&&e.phase.asApplyExtrinsic.toNumber()===idx);
   try{finalizedDispatch(own);}catch(e){row.status='failed';storage.removeItem(NATIVE_PENDING_KEY);const failed={...row,status:'failed',blockHash:hash.toHex(),error:String(e)};storage.setItem('pactpay.native.last',serialize(failed));recordNativeHistory(storage,failed);throw e;}
   const result={hash:block.block.extrinsics[idx].hash.toHex() as Hex,blockHash:hash.toHex() as Hex,contractAddress:row.predictedContract};const complete={...row,...result,status:'finalized'};storage.setItem('pactpay.native.last',serialize(complete));storage.setItem(NATIVE_PENDING_KEY,serialize(complete));recordNativeHistory(storage,complete);return result;
  }this.scanned.set(row.id,end);return null;
 }
 async recover(storage:Store){await this.identity();const row=pending(storage);if(!row)throw Error('No saved native transaction to reconcile.');if(row.status==='finalized'&&row.hash&&row.blockHash)return{hash:row.hash,blockHash:row.blockHash,contractAddress:row.predictedContract};const result=await this.findFinalized(row,storage);if(!result)throw Error('Outcome not found in recent finalized blocks. Check extension activity; the saved intent remains blocked and will not resend.');return result;}
 acknowledge(storage:Store,result:FinalizedNativeTx){const row=pending(storage);if(!row||row.status!=='finalized'||row.hash!==result.hash||row.blockHash!==result.blockHash)throw Error('Finalized acknowledgement does not match saved transaction.');storage.removeItem(NATIVE_PENDING_KEY);}
 async disconnect(){await this.api.disconnect();}
}
export async function createNativeAdapter(){const api=await ApiPromise.create({provider:new WsProvider(NATIVE_RPC),noInitWarn:true});const adapter=new NativeAdapter(api);try{await adapter.identity();return adapter;}catch(e){await api.disconnect();throw e;}}
