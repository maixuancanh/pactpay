import {cryptoWaitReady,decodeAddress,encodeAddress,signatureVerify} from '@polkadot/util-crypto';
import {u8aToHex,u8aEq} from '@polkadot/util';
import {ApiPromise,WsProvider} from '@polkadot/api';
import {isAddress} from 'viem';
import {hash,id,requireThat,text,token} from '../lib.js';
import {upsertIdentity} from './session.js';
import type {Database} from '../db/database.js';
import {V3_GENESIS} from '../indexer/native-reader.js';

export type NativeMapper=(address:string)=>Promise<string>;
export async function nativeMapping(address:string){
 const provider=new WsProvider('wss://test-node-v3.portaldot.dev',1000);
 let timer:ReturnType<typeof setTimeout>|undefined;
 const api=await Promise.race([ApiPromise.create({provider,noInitWarn:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void provider.disconnect();reject(Error('Native login network check timed out'));},12000);})]).finally(()=>clearTimeout(timer));
 try{
  requireThat(api.genesisHash.toHex()===V3_GENESIS,'native_genesis_mismatch');
  const at=await api.at(await api.rpc.chain.getFinalizedHead());
  const mapped=(await (at.call as any).reviveApi.address(address)).toString();
  requireThat(isAddress(mapped),'native_mapping_invalid');
  const inverse=(await (at.call as any).reviveApi.accountId(mapped)).toString();
  const original=await (at.query as any).revive.originalAccount(mapped);
  requireThat(original.isSome&&u8aEq(decodeAddress(address),decodeAddress(inverse))&&u8aEq(decodeAddress(address),decodeAddress(original.unwrap().toString())),'native_account_not_mapped');
  return mapped.toLowerCase();
 }finally{await api.disconnect();}
}
export function nativeLogin(db:Database,origin:string,chainId:number,map:NativeMapper=nativeMapping){
 requireThat(chainId===420420777,'native_login_wrong_chain');
 return {
  async challenge(nativeAddress:unknown,context:string){
   await cryptoWaitReady();
   const bytes=decodeAddress(text(nativeAddress,100));
   requireThat(bytes.length===32,'native_account_id_required');
   const address=encodeAddress(bytes,42),publicKey=u8aToHex(bytes),challengeId=id();
   const expiresAt=new Date(Date.now()+5*60000);
   const message=['Sign in to PactPay',new URL(origin).origin,'Portaldot V3 testnet',address,'Challenge '+challengeId,'Expires '+expiresAt.toISOString(),'This signature verifies wallet ownership for your booking workspace.'].join('\n');
   await db.query('INSERT INTO native_login_challenges(id,context_hash,public_key,native_address,message,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[challengeId,hash(context),publicKey,address,message,expiresAt]);
   return {id:challengeId,message,address};
  },
  async verify(challengeId:unknown,signature:unknown,context:string){
   await cryptoWaitReady();
   const challenge=(await db.query('SELECT * FROM native_login_challenges WHERE id=$1',[text(challengeId,100)])).rows[0];
   requireThat(challenge&&!challenge.consumed_at&&Date.parse(challenge.expires_at)>Date.now()&&challenge.context_hash===hash(context),'native_challenge_expired',undefined,401);
   requireThat(signatureVerify(challenge.message,text(signature,300),challenge.native_address).isValid,'native_signature_invalid',undefined,401);
   const mapped=await map(challenge.native_address);
   return db.transaction(async tx=>{
    const row=(await tx.query('UPDATE native_login_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING id',[challenge.id])).rows[0];
    requireThat(row,'native_challenge_used',undefined,409);
    const user=await upsertIdentity(tx,{issuer:'portaldot-native:'+V3_GENESIS,subject:challenge.public_key,displayName:challenge.native_address.slice(0,7)+'...'+challenge.native_address.slice(-5)});
    const existing=(await tx.query('SELECT * FROM wallet_bindings WHERE chain_id=$1 AND account_address=$2',[chainId,mapped])).rows[0];
    requireThat(!existing||existing.user_id===user.id,'native_wallet_already_bound',undefined,409);
    await tx.query("INSERT INTO wallet_bindings(id,user_id,provider,wallet_id,owner_address,account_address,chain_id,mode) VALUES($1,$2,'polkadot-js',$3,$4,$4,$5,'native') ON CONFLICT(user_id,provider,chain_id) DO NOTHING",[id(),user.id,challenge.public_key,mapped,chainId]);
    const sessionToken=token(),csrfToken=token();
    await tx.query('INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)',[hash(sessionToken),user.id,hash(csrfToken),new Date(Date.now()+8*3600000)]);
    return {user,sessionToken,csrfToken};
   });
  },
 };
}
