import {decodeAddress, encodeAddress} from '@polkadot/util-crypto';
import type {Address, Hex} from 'viem';
import type {Database, Row} from '../db/database.js';
import {Rooms} from '../rooms/service.js';
import {requireThat} from '../lib.js';
import type {ProtectedConfig} from '../payments/protected-rooms.js';
import {NativeRelayDriver} from './native-driver.js';
import {buildProtectedRelayPlan} from './protected-planner.js';
import type {RelayAction} from './compact-planner.js';

/** Read-only preparation. The named browser wallet alone authorizes and pays execution. */
export async function manualProtectedPlan(db:Database, deployment:ProtectedConfig, userId:string, roomId:string, input:Row) {
  requireThat(deployment.chainId===420420777,'protected_chain_mismatch');
  const room=await new Rooms(db,deployment.chainId).get(userId,roomId);
  requireThat(room.settlementVersion==='protected-v2','relay_version_mismatch');
  const action=input.kind as RelayAction;
  requireThat(['publish','payment','merchant-payout','refund','cancel'].includes(action),'relay_action_invalid');
  const merchant=room.merchantId===userId;
  requireThat(!['publish','merchant-payout','cancel'].includes(action)||merchant,'relay_merchant_required',undefined,403);
  const registration=(await db.query('SELECT * FROM atomic_accounts WHERE user_id=$1 AND chain_id=$2',[userId,deployment.chainId])).rows[0];
  const actor=merchant?room.merchantAccountAddress:room.members.find((m:Row)=>m.userId===userId)?.accountAddress;
  const binding=(await db.query('SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2',[userId,deployment.chainId])).rows[0];
  requireThat(registration&&binding&&registration.binding_id===binding.id&&registration.owner_address===binding.owner_address&&actor?.toLowerCase()===registration.account_address,'relay_room_account_mismatch',undefined,409);
  requireThat(typeof input.payerNative==='string'&&input.payerNative.length<=64,'invalid_fee_payer');
  const bytes=decodeAddress(input.payerNative);
  requireThat(bytes.length===32,'invalid_fee_payer');
  const payerNative=encodeAddress(bytes,42);
  const expiresAt=Number(input.expiresAt);
  requireThat(Number.isSafeInteger(expiresAt)&&expiresAt>Date.now()&&expiresAt<=Date.now()+600000,'relay_quote_expired');
  const driver=await NativeRelayDriver.connect(process.env.NATIVE_RPC??'wss://test-node-v3.portaldot.dev',{
    address:payerNative,sign:async()=>{throw Error('Browser fee authorization is required');},
  });
  try {
    const account=registration.account_address as Address,owner=registration.owner_address as Address;
    const identity=await driver.quote({account,owner});
    const escrow=deployment.address as Address;
    const snapshot=await driver.readProtectedSnapshot(account,escrow,room.protectedBooking?.quoteId as Hex|undefined);
    const plan=buildProtectedRelayPlan({room,account,action,escrow,token:snapshot.token,snapshot,now:Date.now(),expiresAt});
    return {...plan,binding:{...plan.binding,feePayer:input.payerNative},owner,nonce:identity.nonce,relayer:identity.relayer,payerNative};
  } finally {await driver.disconnect();}
}
