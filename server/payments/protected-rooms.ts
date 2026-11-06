import {createPublicClient,http,parseAbi,type Address,type Hex} from 'viem';
import type {Database,Row} from '../db/database.js';
import {requireThat,hex32} from '../lib.js';
import {authorizedRoom,roomView} from '../rooms/service.js';
import {nativeReader} from '../indexer/native-reader.js';
import {evmReader} from '../indexer/evm-reader.js';

const abi=parseAbi([
 'function booking(bytes32) view returns ((address merchant,uint8 state,uint64 fundingDeadline,uint64 captureDeadline,uint64 window,uint64 resolutionPeriod,uint64 capturedAt,uint256 total,uint256 funded,bytes32 termsHash,address[] members))',
 'function positions(bytes32,address) view returns (uint256,uint256,uint256,bool,bool)',
 'function credits(address) view returns (uint256)',
]);
export type ProtectedConfig={version:'protected-v2';chainId:number;rpcUrl:string;address:string;deploymentBlock:string};
export function protectedRooms(db:Database,deployment:ProtectedConfig){
 const client=createPublicClient({transport:http(deployment.rpcUrl,{timeout:12000,retryCount:1})});
 async function snapshot(quoteId:Hex,accounts?:string[]){
  requireThat(await client.getChainId()===deployment.chainId,'protected_chain_mismatch');
  const block=await client.getBlock({blockTag:'finalized'});
  requireThat(block.number!==null&&block.number>=BigInt(deployment.deploymentBlock),'protected_finality_missing');
  const options={address:deployment.address as Address,abi,blockNumber:block.number};
  const booking=await client.readContract({...options,functionName:'booking',args:[quoteId]});
  const positions=await Promise.all((accounts??booking.members).map(async account=>{
   const [position,credit]=await Promise.all([
    client.readContract({...options,functionName:'positions',args:[quoteId,account as Address]}),
    client.readContract({...options,functionName:'credits',args:[account as Address]}),
   ]);
   return {account,position,credit};
  }));
  return {source:'rpc-finalized',blockNumber:String(block.number),blockHash:block.hash,timestamp:block.timestamp,booking,positions};
 }
 async function verifyRoom(room:Row,quoteId:Hex){
  const state=await snapshot(quoteId,room.members.map((m:Row)=>m.accountAddress)),b=state.booking;
  requireThat(b.merchant.toLowerCase()===room.merchantAccountAddress?.toLowerCase()&&b.termsHash===room.termsHash,'protected_terms_mismatch');
  requireThat(String(b.total)===room.total&&Number(b.fundingDeadline)===Date.parse(room.fundingDeadline)/1000&&Number(b.captureDeadline)===Date.parse(room.serviceAt)/1000&&Number(b.window)===room.complaintSeconds&&Number(b.resolutionPeriod)===room.resolutionSeconds,'protected_policy_mismatch');
  requireThat(b.members.length===room.members.length&&b.members.every((a:string,i:number)=>a.toLowerCase()===room.members[i].accountAddress.toLowerCase())&&state.positions.every((p:Row,i:number)=>String(p.position[0])===room.members[i].share),'protected_roster_mismatch');
  return state;
 }
 return {
  async publicReceipt(quoteId:Hex){
   const state=await snapshot(quoteId);
   requireThat(state.booking.state!==0,'protected_booking_not_found',undefined,404);
   const merchantCredit=await client.readContract({address:deployment.address as Address,abi,blockNumber:BigInt(state.blockNumber),functionName:'credits',args:[state.booking.merchant]});
   return {
    blockNumber:state.blockNumber,
    blockHash:state.blockHash,
    total:String(state.booking.total),
    state:state.booking.state,
    merchantCredit:String(merchantCredit),
    positions:state.positions.map(({account,position,credit})=>({
     account:account.toLowerCase(),share:String(position[0]),paid:String(position[1]),disputed:position[3],settled:position[4],contractCredit:String(credit),
    })),
   };
  },
  async bind(userId:string,roomId:string,input:Row){
   const room=await roomView(db,roomId);
   await authorizedRoom(db,roomId,userId,true);
   requireThat(room.settlementVersion==='protected-v2'&&['locked','published'].includes(room.status)&&room.revision===input.revision,'protected_locked_revision_required',undefined,409);
   const quoteId=hex32(input.quoteId);
   await verifyRoom(room,quoteId as Hex);
   // A finalized Created event is required in addition to matching current storage.
   const reader=deployment.chainId===420420777?nativeReader('wss://test-node-v3.portaldot.dev',deployment.chainId,deployment.address as Hex,undefined,'V2'):evmReader(deployment.rpcUrl,deployment.chainId,deployment.address as Hex,'V2');
   const number=BigInt(String(input.blockNumber));
   requireThat(number>=BigInt(deployment.deploymentBlock),'protected_block_out_of_range');
   const page=await reader.readFinalized(number,1);
   const created=page.events.find(e=>e.kind==='Created'&&e.quoteId===quoteId&&e.txHash===hex32(input.txHash));
   requireThat(created,'protected_created_event_required');
   return db.transaction(async tx=>{
    const locked=await authorizedRoom(tx,roomId,userId,true,true);
    requireThat(locked.revision===room.revision&&['locked','published'].includes(locked.status),'protected_revision_changed',undefined,409);
    await tx.query('INSERT INTO protected_room_bindings(room_id,revision,quote_id,escrow,chain_id,block_number,block_hash,tx_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(room_id) DO NOTHING',[roomId,room.revision,quoteId,deployment.address,deployment.chainId,created.blockNumber,created.blockHash,created.txHash]);
    const binding=(await tx.query('SELECT quote_id FROM protected_room_bindings WHERE room_id=$1',[roomId])).rows[0];
    requireThat(binding.quote_id===quoteId,'protected_already_bound',undefined,409);
    await tx.query('INSERT INTO protected_room_events(room_id,tx_hash,log_index,block_number,block_hash,event_name,event_args) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[roomId,created.txHash,created.logIndex,created.blockNumber,created.blockHash,created.kind,JSON.stringify(created.payload)]);
    await tx.query("UPDATE rooms SET status='published' WHERE id=$1",[roomId]);
    return roomView(tx,roomId);
   });
  },
  async read(userId:string,roomId:string){
   await authorizedRoom(db,roomId,userId);
   const room=await roomView(db,roomId);
   requireThat(room.protectedBooking,'protected_booking_not_published',undefined,409);
   const state=await verifyRoom(room,room.protectedBooking.quoteId as Hex);
   const merchantCredit=await client.readContract({address:deployment.address as Address,abi,functionName:'credits',args:[room.merchantAccountAddress as Address],blockNumber:BigInt(state.blockNumber)});
   const events=(await db.query('SELECT * FROM protected_room_events WHERE room_id=$1 ORDER BY block_number::bigint,log_index',[roomId])).rows;
   return JSON.parse(JSON.stringify({...state,merchantCredit,events,coverage:'Only transactions verified for this room are listed. Credits are pooled across this contract.'},(_,value)=>typeof value==='bigint'?String(value):value));
  },
  async record(userId:string,roomId:string,input:Row){
   await authorizedRoom(db,roomId,userId);
   const room=await roomView(db,roomId);
   requireThat(room.protectedBooking,'protected_booking_not_published');
   const reader=deployment.chainId===420420777?nativeReader('wss://test-node-v3.portaldot.dev',deployment.chainId,deployment.address as Hex,undefined,'V2'):evmReader(deployment.rpcUrl,deployment.chainId,deployment.address as Hex,'V2');
   const number=BigInt(String(input.blockNumber));
   requireThat(number>=BigInt(room.protectedBooking.blockNumber),'protected_block_out_of_range');
   const page=await reader.readFinalized(number,1);
   const events=page.events.filter(e=>e.txHash===hex32(input.txHash)&&(e.quoteId===room.protectedBooking!.quoteId||(e.kind==='Claimed'&&[room.merchantAccountAddress,...room.members.map(m=>m.accountAddress)].some(a=>a?.toLowerCase()===e.payload.recipient))));
   requireThat(events.length>0,'protected_transaction_unverified');
   for(const event of events)await db.query('INSERT INTO protected_room_events(room_id,tx_hash,log_index,block_number,block_hash,event_name,event_args) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[roomId,event.txHash,event.logIndex,event.blockNumber,event.blockHash,event.kind,JSON.stringify(event.payload)]);
   return {recorded:true};
  },
 };
}
