import {readFileSync} from 'node:fs';
import {keccak256,type Hex} from 'viem';
import type {Database,Sql,Row} from '../db/database.js';
import {address,hex32,requireThat} from '../lib.js';
import {V3_GENESIS} from '../indexer/native-reader.js';
const artifact=JSON.parse(readFileSync(new URL('./compact-runtime.json',import.meta.url),'utf8')) as {runtime:Hex;immutableOffsets:number[]};
/** Pinned Solidity 0.8.24 compact-v1 runtime; only its two owner immutable words vary. */
export function compactRuntime(owner:string):Hex{const word=address(owner).slice(2).padStart(64,'0');let runtime=artifact.runtime;for(const offset of artifact.immutableOffsets)runtime=(runtime.slice(0,2+offset*2)+word+runtime.slice(2+(offset+32)*2)) as Hex;return runtime;}
export type AtomicAccountProof={accountAddress:string;ownerAddress:string;chainId:number;genesis:string;blockHash:string;blockNumber:string;finality:'finalized';runtime:string};
export type AtomicAccountVerifier=(account:Hex,owner:Hex)=>Promise<AtomicAccountProof>;
function view(row:Row){return {accountAddress:row.account_address,ownerAddress:row.owner_address,chainId:Number(row.chain_id),active:row.active,verifiedAt:new Date(row.verified_at).toISOString(),blockNumber:row.block_number,blockHash:row.block_hash};}
export class AtomicAccounts{
 constructor(private db:Database,private chainId:number,private verify?:AtomicAccountVerifier){}
 async get(userId:string){const row=(await this.db.query('SELECT * FROM atomic_accounts WHERE user_id=$1 AND chain_id=$2',[userId,this.chainId])).rows[0];return row?view(row):null;}
 async register(userId:string,raw:unknown){
  requireThat(this.verify,'atomic_verifier_unavailable',undefined,503);
  const account=address(raw) as Hex,binding=(await this.db.query('SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2',[userId,this.chainId])).rows[0];
  requireThat(binding,'wallet_binding_required',undefined,409);
  // Compact accounts attach only to the canonical provider-verified Google EOA.
  requireThat(binding.provider.startsWith('privy:')&&binding.mode==='embedded-eoa'&&binding.owner_address===binding.account_address,'canonical_google_eoa_required',undefined,403);
  const owner=address(binding.owner_address) as Hex;
  requireThat(account!==owner,'deployed_account_required');
  const proof=await this.verify!(account,owner);
  requireThat(proof.chainId===this.chainId&&this.chainId===420420777&&proof.genesis.toLowerCase()===V3_GENESIS,'atomic_chain_mismatch',undefined,409);
  requireThat(proof.finality==='finalized'&&/^\d+$/.test(proof.blockNumber),'atomic_finality_required',undefined,409);hex32(proof.blockHash);
  requireThat(address(proof.accountAddress)===account&&address(proof.ownerAddress)===owner,'atomic_owner_mismatch',undefined,403);
  requireThat(proof.runtime.toLowerCase()===compactRuntime(owner),'atomic_runtime_mismatch',undefined,409);
  return this.db.transaction(async tx=>{
   const current=(await tx.query('SELECT * FROM wallet_bindings WHERE id=$1 AND user_id=$2 FOR UPDATE',[binding.id,userId])).rows[0];
   requireThat(current?.owner_address===owner&&current.account_address===owner,'binding_changed',undefined,409);
   const old=(await tx.query('SELECT * FROM atomic_accounts WHERE user_id=$1 AND chain_id=$2 FOR UPDATE',[userId,this.chainId])).rows[0];
   requireThat(!old||old.account_address===account,'atomic_account_changed',undefined,409);
   const other=(await tx.query('SELECT user_id FROM atomic_accounts WHERE chain_id=$1 AND account_address=$2',[this.chainId,account])).rows[0];
   requireThat(!other||other.user_id===userId,'atomic_account_forbidden',undefined,403);
   const row=(await tx.query(`INSERT INTO atomic_accounts(user_id,binding_id,chain_id,account_address,owner_address,block_number,block_hash,genesis,runtime_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,chain_id) DO UPDATE SET verified_at=now(),block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash RETURNING *`,[userId,binding.id,this.chainId,account,owner,proof.blockNumber,proof.blockHash,V3_GENESIS,keccak256(proof.runtime as Hex)])).rows[0];return view(row);
  });
 }
 async activate(userId:string,enabled:unknown){requireThat(typeof enabled==='boolean','invalid_atomic_activation');const row=(await this.db.query('UPDATE atomic_accounts SET active=$3 WHERE user_id=$1 AND chain_id=$2 RETURNING *',[userId,this.chainId,enabled])).rows[0];requireThat(row,'atomic_registration_required',undefined,409);return view(row);}
}
/** Selection is explicit for each new room/join. Activation never rewrites old rights. */
export async function selectRoomAccount(tx:Sql,userId:string,chainId:number,requested:unknown){const binding=(await tx.query('SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2',[userId,chainId])).rows[0];requireThat(binding,'wallet_binding_required',undefined,409);if(requested===undefined||address(requested)===binding.account_address)return {binding,accountAddress:binding.account_address,atomic:false};const account=address(requested),registered=(await tx.query('SELECT * FROM atomic_accounts WHERE user_id=$1 AND chain_id=$2 AND account_address=$3',[userId,chainId,account])).rows[0];requireThat(registered?.active&&registered.binding_id===binding.id&&registered.owner_address===binding.owner_address,'atomic_account_forbidden',undefined,403);return {binding,accountAddress:account,atomic:true};}
