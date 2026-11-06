import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256,type Hex} from 'viem';
import {relayAuthorization,relayExecution,decodeRelayExecution} from '../sponsorship/compact-codec.js';
import {embedded} from '../db/database.js';
import {migrate} from '../db/migrate.js';
import {persistPrivyProfile} from '../auth/privy.js';
import {Rooms} from '../rooms/service.js';
import {CompactRelay,type RelayDriver} from '../sponsorship/compact-relay.js';
import {createApp} from '../app.js';
const owner=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),account=('0x'+'22'.repeat(20)) as Hex,relayer=('0x'+'33'.repeat(20)) as Hex;
test('compact relay binds owner signature, nonce, payer and complete call bytes without persisting signature',async()=>{
 const request={account,owner:owner.address,relayer,chainId:420420777 as const,nonce:'7',deadline:'2000000000',maxFee:'10',maxStorage:'20',calls:[{target:('0x'+'44'.repeat(20)) as Hex,data:'0x11223344' as Hex}]};
 const signature=await owner.signTypedData(relayAuthorization(request));const raw=relayExecution({...request,signature});const decoded=decodeRelayExecution(raw);
 assert.equal(decoded.nonce,'7');assert.equal(decoded.deadline,request.deadline);assert.deepEqual(decoded.calls,request.calls);assert.equal(keccak256(raw).length,66);
 assert.throws(()=>decodeRelayExecution((raw+'00') as Hex));
 assert.throws(()=>decodeRelayExecution('0x1234'));
});
async function fixture(){
 const db=embedded();await migrate(db);const {user}=await persistPrivyProfile(db,'test',420420777,{id:'did:privy:relay',linked_accounts:[{type:'google_oauth',name:'Merchant'},{type:'wallet',id:'wallet',address:owner.address,wallet_client_type:'privy',chain_type:'ethereum',user_can_sign:true}]});
 const b=(await db.query('SELECT * FROM wallet_bindings WHERE user_id=$1',[user.id])).rows[0];await db.query("INSERT INTO atomic_accounts(user_id,binding_id,chain_id,account_address,owner_address,active,block_number,block_hash,genesis,runtime_hash) VALUES($1,$2,420420777,$3,$4,true,'1',$5,$5,$5)",[user.id,b.id,account,owner.address.toLowerCase(),'0x'+'aa'.repeat(32)]);
 const rooms=new Rooms(db,420420777);let room=await rooms.create(user.id,{title:'Sponsored booking',publicTerms:'Reviewed terms',total:'10',fundingDeadline:new Date(Date.now()+3600000).toISOString(),serviceAt:new Date(Date.now()+7200000).toISOString(),accountAddress:account});const invite=await rooms.invite(user.id,room.id,{expiresAt:new Date(Date.now()+300000).toISOString()});room=await rooms.join(user.id,invite.token,{nickname:'Merchant',share:'10',accountAddress:account});room=await rooms.accept(user.id,room.id,room.revision);room=await rooms.lock(user.id,room.id,room.revision);
 await db.query("INSERT INTO sponsorship_budgets(id,merchant_id,cap,enabled) VALUES('budget',$1,'1000',true)",[user.id]);let sends=0,settled=false;
 const driver:RelayDriver={quote:async()=>({nonce:'0',relayer,payerNative:'native-payer',spendable:'10000'}),readSnapshot:async()=>{throw Error('Publish needs no existing quote');},prepare:async()=>({fee:'3',storage:'4',methodHash:('0x'+'ab'.repeat(32)) as Hex}),sign:async()=>({hash:('0x'+'cd'.repeat(32)) as Hex,signed:'0x1234',nonce:1,startBlock:1,methodHash:('0x'+'ab'.repeat(32)) as Hex,payerNative:'native-payer'}),broadcast:async()=>{sends++;throw Error('Lost reply after broadcast');},reconcile:async()=>({status:settled?'finalized':'unknown',settlementKnown:settled,actualFee:settled?'3':undefined,actualStorage:settled?'4':null})};
 const config={driver,escrow:('0x'+'44'.repeat(20)) as Hex,token:('0x'+'55'.repeat(20)) as Hex,feeCap:'10',storageCap:'20',maxPerAccountDay:'1000',maxPerRoomDay:'1000',accepted:true};
 return {db,user,room,config,relay:new CompactRelay(db,config),sends:()=>sends,settle:()=>{settled=true;}};
}
test('a booking cap below the reserved fee and storage blocks sponsorship before signing',async()=>{
 const f=await fixture();
 try{
  const limited=new CompactRelay(f.db,{...f.config,maxPerAccountDay:'29',maxPerRoomDay:'29'});
  await assert.rejects(limited.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'over-cap'}),/sponsor_daily_cap/);
  assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'0');
  assert.equal(f.sends(),0);
 }finally{await f.db.close();}
});
test('the total booking cap retains older commitments when the daily cap resets',async()=>{
 const f=await fixture();
 try{
  const limited=new CompactRelay(f.db,{...f.config,maxPerAccountDay:'35',maxPerRoomDay:'35',maxPerRoom:'50'});
  await limited.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'day-one'});
  await f.db.query("UPDATE sponsorship_reservations SET authorization_data=jsonb_set(authorization_data,'{reservedDay}','\"2000-01-01\"')");
  await assert.rejects(limited.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'next-day'}),/sponsor_booking_cap/);
  assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'30');
  assert.equal(f.sends(),0);
 }finally{await f.db.close();}
});
test('automatic relay recovers after reply loss on another instance and settles actual costs once',async()=>{const f=await fixture();try{
 const intent=await f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'one'});assert.equal(intent.status,'quoted');assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'30');
 await assert.rejects(f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'two'}));assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'30');
 const signature=await owner.signTypedData(relayAuthorization(intent as any));const sent=await f.relay.submit(f.user.id,f.room.id,intent.id,signature);assert.equal(sent.status,'unknown');await f.relay.submit(f.user.id,f.room.id,intent.id,signature);assert.equal(f.sends(),1);
 const saved=JSON.stringify((await f.db.query('SELECT * FROM compact_relay_intents')).rows);assert.ok(!saved.includes(signature));assert.ok(!saved.includes('0x1234'));
 f.settle();const other=new CompactRelay(f.db,f.config);assert.equal((await other.get(f.user.id,f.room.id,intent.id)).status,'finalized');await other.get(f.user.id,f.room.id,intent.id);const budget=(await f.db.query("SELECT * FROM sponsorship_budgets WHERE id='budget'")).rows[0];assert.equal(budget.reserved,'0');assert.equal(budget.spent,'7');assert.equal(f.sends(),1);
 }finally{await f.db.close();}});
test('paused budgets, forged signatures and unauthorized recovery never reach native signing',async()=>{const f=await fixture();try{
 const intent=await f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'one'});await assert.rejects(f.relay.get('outsider',f.room.id,intent.id));const wrong=await privateKeyToAccount(('0x'+'66'.repeat(32)) as Hex).signTypedData(relayAuthorization(intent as any));await assert.rejects(f.relay.submit(f.user.id,f.room.id,intent.id,wrong));await f.db.query("UPDATE sponsorship_budgets SET enabled=false WHERE id='budget'");const signature=await owner.signTypedData(relayAuthorization(intent as any));await assert.rejects(f.relay.submit(f.user.id,f.room.id,intent.id,signature));assert.equal(f.sends(),0);await f.relay.cancel(f.user.id,f.room.id,intent.id);assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'0');
 }finally{await f.db.close();}});
test('confirmed money is distinguished from unknown storage accounting; budgets remain held',async()=>{const f=await fixture();try{
 const intent=await f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'storage-unknown'}),signature=await owner.signTypedData(relayAuthorization(intent as any));await f.relay.submit(f.user.id,f.room.id,intent.id,signature);
 f.config.driver.reconcile=async()=>({status:'finalized',actualFee:'3',actualStorage:null,settlementKnown:false,blockNumber:'2',blockHash:'0x'+'cc'.repeat(32)});
 const done=await f.relay.get(f.user.id,f.room.id,intent.id);assert.equal(done.status,'finalized');assert.equal(done.settlementPending,true);const b=(await f.db.query("SELECT * FROM sponsorship_budgets WHERE id='budget'")).rows[0];assert.equal(b.reserved,'30');assert.equal(b.spent,'0');assert.equal((await f.db.query('SELECT * FROM compact_relay_signer_lock')).rows.length,0);
 }finally{await f.db.close();}});
test('an explicit signature failure before broadcast releases the reservation and cannot strand signer lock',async()=>{const f=await fixture();try{
 const intent=await f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'sign-failure'});f.config.driver.sign=async()=>{throw Error('Signer unavailable before any broadcast');};const signature=await owner.signTypedData(relayAuthorization(intent as any));const result=await f.relay.submit(f.user.id,f.room.id,intent.id,signature);assert.equal(result.status,'released');assert.equal(f.sends(),0);assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'0');assert.equal((await f.db.query('SELECT * FROM compact_relay_signer_lock')).rows.length,0);
 }finally{await f.db.close();}});
test('HTTP sponsored checkout and another-device recovery enforce CSRF and never broadcast twice',async()=>{const f=await fixture();const origin='http://127.0.0.1:5173';const app=createApp(f.db,{origin,chainId:420420777,secureCookies:false,compactRelay:f.relay,verifyIdentity:async()=>({issuer:'privy:test',subject:'did:privy:relay',displayName:'Merchant'})});let second:ReturnType<typeof createApp>|undefined;try{
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+(app.server.address() as any).port,login=await app.sessions.login('fixture'),headers={cookie:'pactpay_session='+login.sessionToken,origin,'Content-Type':'application/json','X-CSRF-Token':login.csrfToken};
 const path='/api/rooms/'+f.room.id+'/sponsored-intents';assert.equal((await fetch(base+path,{method:'POST',headers:{...headers,'X-CSRF-Token':'forged'},body:JSON.stringify({kind:'publish',idempotencyKey:'http'})})).status,403);
 const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({kind:'publish',idempotencyKey:'http'})});assert.equal(response.status,201);const {intent}=await response.json() as any;const signature=await owner.signTypedData(relayAuthorization(intent));const submitted=await fetch(base+path+'/'+intent.id+'/submit',{method:'POST',headers,body:JSON.stringify({signature})});assert.equal(submitted.status,200);assert.equal(f.sends(),1);
 second=createApp(f.db,{origin,chainId:420420777,secureCookies:false,compactRelay:new CompactRelay(f.db,f.config)});await new Promise<void>(resolve=>second!.server.listen(0,'127.0.0.1',resolve));const other='http://127.0.0.1:'+(second.server.address() as any).port;f.settle();const recovered=await fetch(other+path+'/'+intent.id,{headers:{cookie:headers.cookie}});assert.equal((await recovered.json() as any).intent.status,'finalized');assert.equal(f.sends(),1);
 }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));if(second)await new Promise<void>(resolve=>second!.server.close(()=>resolve()));await f.db.close();}});
test('operator circuit, global daily cap and approved merchant scope reject unfunded requests',async()=>{const f=await fixture();try{
 await assert.rejects(new CompactRelay(f.db,{...f.config,maxGlobalDay:'29'}).create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'global'}),/global_daily_cap/);
 assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'0');
 await assert.rejects(f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'global'}),/reservation_already_closed/);
 assert.equal((await f.db.query('SELECT * FROM compact_relay_intents')).rows.length,0);
 await f.db.query('UPDATE compact_relay_control SET enabled=false WHERE id=1');await assert.rejects(f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'paused'}),/circuit_paused/);
 assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'0');
 assert.equal((await new CompactRelay(f.db,{...f.config,merchantOwners:[]}).status(f.user.id,f.room.id)).available,false);assert.equal(f.sends(),0);
 }finally{await f.db.close();}});
test('sponsored publication records its quote intent before signing so the finalized indexer can bind the room',async()=>{const f=await fixture();try{
 const originalSign=f.config.driver.sign;f.config.driver.sign=async p=>{const rows=(await f.db.query('SELECT * FROM payment_intents WHERE room_id=$1',[f.room.id])).rows;assert.equal(rows.length,1);return originalSign(p);};
 const intent=await f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'publish-parent'}),signature=await owner.signTypedData(relayAuthorization(intent as any));const sent=await f.relay.submit(f.user.id,f.room.id,intent.id,signature);const publication=(await f.db.query('SELECT * FROM payment_intents WHERE room_id=$1',[f.room.id])).rows[0];assert.equal(publication.quote_id,intent.binding.quoteId);assert.equal(publication.tx_hash,sent.txHash);
 }finally{await f.db.close();}});
test('merchant pause while the operator is signing blocks broadcast and releases the unused budget',async()=>{const f=await fixture();try{
 const originalSign=f.config.driver.sign;f.config.driver.sign=async p=>{await f.db.query("UPDATE sponsorship_budgets SET enabled=false WHERE id='budget'");return originalSign(p);};
 const intent=await f.relay.create(f.user.id,f.room.id,{kind:'publish',idempotencyKey:'pause-during-sign'}),signature=await owner.signTypedData(relayAuthorization(intent as any));assert.equal((await f.relay.submit(f.user.id,f.room.id,intent.id,signature)).status,'released');assert.equal(f.sends(),0);assert.equal((await f.db.query("SELECT reserved FROM sponsorship_budgets WHERE id='budget'")).rows[0].reserved,'0');
 }finally{await f.db.close();}});
