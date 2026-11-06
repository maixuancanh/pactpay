import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keyring} from '@polkadot/keyring';
import {cryptoWaitReady} from '@polkadot/util-crypto';
import {u8aToHex} from '@polkadot/util';
import {embedded} from '../db/database.js';
import {migrate} from '../db/migrate.js';
import {nativeLogin} from '../auth/native-login.js';
test('native login verifies ownership, browser context and single use before issuing stable wallet sessions',async()=>{
 await cryptoWaitReady();
 const db=embedded();
 try{
  await migrate(db);
  const pair=new Keyring({type:'sr25519'}).addFromUri('//Alice');
  const mapped='0x'+'11'.repeat(20);
  const login=nativeLogin(db,'http://127.0.0.1:5173',420420777,async()=>mapped);
  const challenge=await login.challenge(pair.address,'browser-one');
  const signature=u8aToHex(pair.sign(challenge.message));
  await assert.rejects(()=>login.verify(challenge.id,signature,'browser-two'),/native_challenge_expired/);
  await assert.rejects(()=>login.verify(challenge.id,'0x'+'00'.repeat(64),'browser-one'),/native_signature_invalid/);
  const first=await login.verify(challenge.id,signature,'browser-one');
  await assert.rejects(()=>login.verify(challenge.id,signature,'browser-one'),/native_challenge_expired/);
  const next=await login.challenge(pair.address,'browser-one');
  const second=await login.verify(next.id,u8aToHex(pair.sign(next.message)),'browser-one');
  assert.equal(first.user.id,second.user.id);
  const bindings=(await db.query('SELECT * FROM wallet_bindings WHERE user_id=$1',[first.user.id])).rows;
  assert.equal(bindings.length,1);
  assert.equal(bindings[0].mode,'native');
  assert.equal(bindings[0].account_address,mapped);
 }finally{await db.close();}
});
