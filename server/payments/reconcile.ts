import {createPublicClient,http,decodeFunctionData,parseAbi,type Hex} from 'viem';
import type {Database,Row} from '../db/database.js';
import {requireThat,hex32} from '../lib.js';
import {authorizedRoom} from '../rooms/service.js';
const actions=parseAbi(['function contribute(bytes32 id,bytes32 expectedTermsHash)','function capture(bytes32 id)','function claim(bytes32 id)','function cancel(bytes32 id)','function expire(bytes32 id)']);
const approval=parseAbi(['function approve(address spender,uint256 value) returns(bool)']);
export type AttemptProof={chainId:number,txHash:string,from:string,to:string,input:Hex,value:string,status:'finalized'|'failed'|'unknown',blockNumber?:string,blockHash?:string,source:string};
export type AttemptReader=(hash:Hex)=>Promise<AttemptProof>;
export function validateAttemptCall(attempt:Row,token:string,share:string,proof:AttemptProof){
 requireThat(proof.chainId===Number(attempt.chain_id)&&proof.from.toLowerCase()===attempt.account_address&&proof.value==='0','attempt_transaction_identity_mismatch',undefined,409);
 if(attempt.action==='approval'){
  requireThat(proof.to.toLowerCase()===token,'attempt_token_mismatch',undefined,409);const call=decodeFunctionData({abi:approval,data:proof.input});requireThat(call.functionName==='approve'&&call.args[0].toLowerCase()===attempt.escrow&&call.args[1].toString()===share,'attempt_approval_mismatch',undefined,409);
 }else{
  requireThat(proof.to.toLowerCase()===attempt.escrow,'attempt_escrow_mismatch',undefined,409);const call=decodeFunctionData({abi:actions,data:proof.input});const names:Record<string,string[]>={payment:['contribute'],refund:['claim'], 'merchant-payout':['claim'],cancel:['cancel']};
  requireThat(names[attempt.action]?.includes(call.functionName)&&call.args[0]===attempt.quote_id,'attempt_action_mismatch',undefined,409);
  if(call.functionName==='contribute')requireThat(call.args[1]===attempt.state.binding.termsHash,'attempt_terms_mismatch',undefined,409);
 }
}
export async function reconcileAttempt(db:Database,userId:string,roomId:string,attemptId:string,reader:AttemptReader,suppliedHash?:unknown){
 await authorizedRoom(db,roomId,userId);
 const attempt=(await db.query('SELECT * FROM payment_attempts WHERE id=$1 AND user_id=$2 AND room_id=$3',[attemptId,userId,roomId])).rows[0];requireThat(attempt,'attempt_not_found',undefined,404);
 const hash=hex32(suppliedHash??attempt.tx_hash);requireThat(!attempt.tx_hash||attempt.tx_hash===hash,'attempt_hash_mismatch',undefined,409);
 const proof=await reader(hash as Hex);requireThat(proof.txHash===hash,'attempt_proof_hash_mismatch');
 const created=(await db.query("SELECT payload FROM chain_events WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 AND kind='QuoteCreated' LIMIT 1",[attempt.chain_id,attempt.escrow,attempt.quote_id])).rows[0],member=(await db.query('SELECT share FROM room_members WHERE room_id=$1 AND user_id=$2',[roomId,userId])).rows[0];
 requireThat(created?.payload.verifiedToken,'original_token_proof_required',undefined,409);validateAttemptCall(attempt,created.payload.verifiedToken,member?.share??'0',proof);
 if(proof.status==='unknown')return {attempt,proof:{source:proof.source,finality:'unknown'}};
 requireThat(proof.blockNumber&&proof.blockHash,'finality_proof_required');hex32(proof.blockHash);
 return db.transaction(async tx=>{const current=(await tx.query('SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE',[attemptId])).rows[0];requireThat(!current.tx_hash||current.tx_hash===hash,'attempt_changed',undefined,409);const state={...current.state,transactionHash:hash,finalized:proof.status==='finalized',submissionUncertain:false,reconciliation:{blockNumber:proof.blockNumber,blockHash:proof.blockHash,source:proof.source,finality:'finalized'}};
 const updated=(await tx.query('UPDATE payment_attempts SET status=$2,tx_hash=$3,state=$4,updated_at=now() WHERE id=$1 RETURNING *',[attemptId,proof.status,hash,JSON.stringify(state)])).rows[0];return {attempt:updated,proof:state.reconciliation};});
}
export function evmAttemptReader(rpc:string,chainId:number):AttemptReader{const client=createPublicClient({transport:http(rpc,{timeout:15000})});return async hash=>{
 requireThat(await client.getChainId()===chainId,'wrong_reconciliation_chain');const transaction=await client.getTransaction({hash});requireThat(transaction.to,'contract_creation_not_supported');const base={chainId,txHash:hash,from:transaction.from.toLowerCase(),to:transaction.to.toLowerCase(),input:transaction.input,value:transaction.value.toString(),source:'rpc-finalized'};
 let receipt;try{receipt=await client.getTransactionReceipt({hash});}catch{return {...base,status:'unknown'};}const head=await client.getBlock({blockTag:'finalized'});if(head.number===null||receipt.blockNumber>head.number)return {...base,status:'unknown'};const block=await client.getBlock({blockNumber:receipt.blockNumber});requireThat(block.hash===receipt.blockHash,'reconciliation_block_mismatch');return {...base,status:receipt.status==='success'?'finalized':'failed',blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash};
 };}
