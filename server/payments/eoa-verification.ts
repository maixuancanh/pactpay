import {createPublicClient,http,parseAbi,type Address,type Hex} from 'viem';
import {ApiPromise,WsProvider} from '@polkadot/api';
import type {Database,Row} from '../db/database.js';
import {hex32,requireThat} from '../lib.js';
import {validateExecutionConfig,forAccount} from './config.js';
import type {ProtectedConfig} from './protected-rooms.js';

const PROBE_DATA='0x506163745061792056332077616c6c657420636865636b' as Hex;
const PROBE_CAP=20000000000000000n; // 0.02 tPOT, Ethereum RPC units.
export function assertVerificationTransaction(account:Address,chainId:number,tx:Row){
 requireThat(tx.from.toLowerCase()===account&&tx.to?.toLowerCase()===account&&tx.value===0n&&tx.input===PROBE_DATA,'verification_transaction_mismatch');
 const feeCap=tx.type==='eip1559'?tx.maxFeePerGas:tx.gasPrice;
 requireThat(tx.chainId===chainId&&typeof feeCap==='bigint'&&feeCap>0n&&typeof tx.gas==='bigint'&&tx.gas>0n&&tx.gas*feeCap<=PROBE_CAP,'verification_budget_mismatch');
}
export function eoaVerification(db:Database,deployment:ProtectedConfig,nativeRpc:string){
 const client=createPublicClient({transport:http(deployment.rpcUrl,{timeout:12000,retryCount:1})});
 async function identity(account:Address){
  requireThat(deployment.chainId===420420777&&await client.getChainId()===420420777,'wrong_execution_chain');
  const provider=new WsProvider(nativeRpc);
  const api=await ApiPromise.create({provider,noInitWarn:true});
  try{
   const properties=await api.rpc.system.properties();
   const decimals=properties.tokenDecimals.unwrapOrDefault()[0]?.toNumber();
   requireThat(decimals===14&&Number((api.consts as any).revive.chainId.toString())===420420777,'unsupported_execution_denomination');
   const mapped=await (api.call as any).reviveApi.accountId(account);
   const inverse=await (api.call as any).reviveApi.address(mapped.toString());
   requireThat(inverse.toString().toLowerCase()===account,'execution_mapping_mismatch');
   return {nativeAddress:mapped.toString()};
  }finally{await api.disconnect();}
 }
 async function execution(account:Address){
  const proof=(await db.query("SELECT * FROM eoa_execution_proofs WHERE account_address=$1 AND chain_id=$2",[account,deployment.chainId])).rows[0];
  if(!proof)return null;
  const token=await client.readContract({address:deployment.address as Address,abi:parseAbi(['function token() view returns(address)']),functionName:'token'});
  return forAccount(validateExecutionConfig({
   rpcUrl:deployment.rpcUrl,token,escrow:deployment.address,maxExecutionFee:'100000000000000',
   maxStorageDeposit:'3000000000000000',maxWalletCreationFee:'0',estimateTtlMs:120000,rpcDecimals:18,nativeDecimals:14,
   denominationEvidence:'Portaldot V3 runtime decimals and EVM finalized receipt '+proof.tx_hash,
   accountCapabilities:{[account]:{verified:true,chainId:deployment.chainId,account,evidence:proof.tx_hash}},
  },deployment.chainId),account);
 }
 return {
  execution,
  async status(wallet:Row){
   requireThat(wallet.mode==='embedded-eoa','embedded_wallet_required');
   const account=wallet.account_address as Address;
   const mapped=await identity(account);
   const [balance,gasPrice,gas,ready]=await Promise.all([
    client.getBalance({address:account}),client.getGasPrice(),
    client.estimateGas({account,to:account,value:0n,data:PROBE_DATA}),execution(account),
   ]);
   requireThat(gas*gasPrice<=PROBE_CAP,'verification_cost_exceeds_cap');
   return {...mapped,account,chainId:deployment.chainId,gas:String(gas),gasPrice:String(gasPrice),
    data:PROBE_DATA,balance:String(balance),required:String(PROBE_CAP),verified:!!ready};
  },
  async verify(wallet:Row,input:Row){
   requireThat(wallet.mode==='embedded-eoa','embedded_wallet_required');
   const account=wallet.account_address as Address,hash=hex32(input.txHash) as Hex;
   await identity(account);
   const [tx,receipt,head]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlock({blockTag:'finalized'})]);
   assertVerificationTransaction(account,deployment.chainId,tx);
   requireThat(head.number!==null&&receipt.blockNumber<=head.number&&receipt.status==='success','verification_not_finalized');
   requireThat((await client.getBlock({blockNumber:receipt.blockNumber})).hash===receipt.blockHash,'verification_block_mismatch');
   await db.query("INSERT INTO eoa_execution_proofs(account_address,chain_id,tx_hash,block_hash,block_number) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_address,chain_id) DO UPDATE SET tx_hash=EXCLUDED.tx_hash,block_hash=EXCLUDED.block_hash,block_number=EXCLUDED.block_number,verified_at=now()",[account,deployment.chainId,hash,receipt.blockHash,String(receipt.blockNumber)]);
   return {verified:true,txHash:hash};
  },
 };
}
