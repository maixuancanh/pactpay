import {test} from 'node:test';
import assert from 'node:assert/strict';
import {embedded} from '../db/database.js';
import {migrate} from '../db/migrate.js';
import {upsertIdentity} from '../auth/session.js';
import {Rooms} from '../rooms/service.js';
import {deliverInApp,enqueue} from '../notifications/worker.js';
import {deliverEmail} from '../notifications/email.js';
import {syncAccount} from '../sync/routes.js';
test('withdrawn contribution receives reminders; repaid and closed bookings do not',async()=>{
 const db=embedded();try{await migrate(db);const u=await upsertIdentity(db,{issuer:'fixture',subject:'reminders',displayName:'M'}),rooms=new Rooms(db,1);
 const room=await rooms.create(u.id,{title:'Booking',publicTerms:'Terms',total:'10',fundingDeadline:new Date(Date.now()+3600000).toISOString(),serviceAt:new Date(Date.now()+7200000).toISOString()});
 const address='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64),escrow='0x'+'2'.repeat(40);
 await db.query("INSERT INTO wallet_bindings(id,user_id,provider,wallet_id,owner_address,account_address,chain_id,mode) VALUES('binding',$1,'fixture','wallet',$2,$2,1,'embedded-eoa')",[u.id,address]);
 await db.query("INSERT INTO room_members(room_id,user_id,binding_id,nickname,account_address,share) VALUES($1,$2,'binding','M',$3,'10')",[room.id,u.id,address]);
 await db.query("UPDATE rooms SET status='published' WHERE id=$1",[room.id]);
 await db.query("INSERT INTO quote_bindings(room_id,revision,terms_hash,chain_id,escrow,quote_id,tx_hash,block_number,block_hash,source) VALUES($1,1,$2,1,$3,$2,$2,'1',$2,'fixture')",[room.id,hash,escrow]);
 await db.query("UPDATE users SET notification_email='m@example.test' WHERE id=$1",[u.id]);
 await db.query("INSERT INTO notification_preferences(user_id,email,quiet_start,quiet_end) VALUES($1,true,0,0)",[u.id]);
 async function event(index:number,kind:string,payload:unknown){await db.query("INSERT INTO chain_events(chain_id,tx_hash,log_index,block_number,block_hash,escrow,quote_id,kind,payload,source,coverage) VALUES(1,$1,$2,$3,$1,$4,$1,$5,$6,'fixture','{}')",[hash,index,String(index),escrow,kind,JSON.stringify(payload)]);}
 await event(1,'Contributed',{member:address,amount:'10'});await event(2,'Withdrawn',{member:address,amount:'10'});
 async function jobs(revision:number){await db.transaction(tx=>enqueue(tx,u.id,room.id,'funding-1h',revision));await db.query("INSERT INTO outbox(id,user_id,room_id,kind,revision,payload,channel,dedup_key) VALUES($1,$2,$3,'funding-1h',1,'{}','email',$1)",['email'+revision,u.id,room.id]);}
 await jobs(1);await deliverInApp(db);let sends=0;await deliverEmail(db,{send:async()=>{sends++;}},'https://app.example');assert.equal(sends,1);assert.equal((await db.query("SELECT status FROM outbox WHERE channel='in-app'")).rows[0].status,'delivered');
 await event(3,'Contributed',{member:address,amount:'10'});await db.query("UPDATE outbox SET status='pending' WHERE kind='funding-1h'");await deliverInApp(db);await deliverEmail(db,{send:async()=>{sends++;}},'https://app.example');assert.equal(sends,1);assert.ok((await db.query("SELECT status FROM outbox")).rows.every(r=>r.status==='cancelled'));
 // A large history must expose every event through stable bounded pages, including ties.
 await db.query("INSERT INTO chain_events(chain_id,tx_hash,log_index,block_number,block_hash,escrow,quote_id,kind,payload,source,coverage) SELECT 1,$1,n, '4',$1,$2,$1,'fixture','{}','fixture','{}' FROM generate_series(4,1004) n",[hash,escrow]);
 const first=await syncAccount(db,rooms,u.id);assert.equal(first.events.length,1000);assert.ok(first.nextCursor);const second=await syncAccount(db,rooms,u.id,first.nextCursor!);assert.equal(second.events.length,4);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.events,...second.events].map(e=>e.log_index)).size,1004);await assert.rejects(syncAccount(db,rooms,u.id,'invalid'));
 }finally{await db.close();}
});
