import {verifyNativeRollback} from './rollback.js';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { compactStripLength } from '@polkadot/util';
import { encodeFunctionData, decodeFunctionResult, keccak256, recoverTypedDataAddress, parseAbi, type Hex, type Address } from 'viem';
import { requireThat } from '../lib.js';
import { V3_GENESIS } from '../indexer/native-reader.js';
import { compactRuntime } from '../auth/atomic-account.js';
import { relayPlannerAbi, type RelaySnapshot } from './compact-planner.js';
import {protectedRelayAbi, type ProtectedRelayBooking, type ProtectedRelaySnapshot} from './protected-planner.js';
import { relayAuthorization, relayExecution, decodeRelayExecution, type SignedRelayRequest } from './compact-codec.js';
import type { RelayDriver, RelayPrepared, RelayJournal } from './compact-relay.js';
const ownerAbi = parseAbi(['function owner() view returns(address)']);
export async function connectNativeReadApi(endpoint:string){
    const provider=new WsProvider(endpoint,false);let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([(async()=>{await provider.connect();return ApiPromise.create({provider,noInitWarn:true});})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Native read connection timeout')),15000);})]);}
    catch(e){await provider.disconnect();throw e;}finally{clearTimeout(timer);}
}
export function nativeReceiptCosts(events: any[], payer: string) {
    const feeEvent = events.find(e => e.section === 'transactionPayment' && e.method === 'TransactionFeePaid' && e.data[0].toString() === payer), actualFee = feeEvent?.data[1].toString();
    const fields = (e: any) => Object.fromEntries(e.meta.fields.map((f: any, i: number) => [f.name.unwrapOr('' + i).toString(), e.data[i].toJSON()]));
    const balances: Record<string, any>[] = events.filter(e => e.section === 'balances').map(e => ({ method: e.method, ...fields(e) })), holds = new Map<string, bigint>(), releases = new Map<string, bigint>();
    let charge = 0n, known = true;
    for (const e of balances) {
        if (!String(JSON.stringify(e.reason)).toLowerCase().includes('revive'))
            continue;
        const who = String(e.who ?? e.account);
        if (e.method === 'Held')
            holds.set(who, (holds.get(who) ?? 0n) + BigInt(e.amount));
        if (e.method === 'Released')
            releases.set(who, (releases.get(who) ?? 0n) + BigInt(e.amount));
        if (['TransferAndHold', 'TransferOnHold'].includes(e.method) && String(e.source ?? e.from) === payer)
            charge += BigInt(e.amount);
    }
    // The runtime may transfer to the contract deposit account and then emit a separate Revive hold.
    for (const e of balances) {
        if (e.method !== 'Transfer')
            continue;
        const amount = BigInt(e.amount), from = String(e.from), to = String(e.to);
        if (from === payer) {
            const held = holds.get(to) ?? 0n;
            if (held >= amount) {
                charge += amount;
                holds.set(to, held - amount);
            }
            else
                known = false;
        }
        else if (to === payer) {
            const released = releases.get(from) ?? 0n;
            if (released >= amount)
                releases.set(from, released - amount);
            else
                known = false;
        }
    }
    if (holds.has(payer))
        charge += holds.get(payer)!;
    return { actualFee, actualStorage: known ? String(charge) : null, settlementKnown: actualFee !== undefined && known };
}
export type NativeRelaySigner = {
    address: string;
    sign: (transaction: any, nonce: number) => Promise<any>;
};
/** The signer is dedicated operator infrastructure; customer keys are never loaded here. */
export class NativeRelayDriver implements RelayDriver {
    constructor(private api: ApiPromise, private signer: NativeRelaySigner, private scanLimit = 2000) { }
    static async connect(endpoint: string, signer: NativeRelaySigner) { const provider = new WsProvider(endpoint, false); let timer: ReturnType<typeof setTimeout> | undefined; try {
        const api = await Promise.race([(async () => { await provider.connect(); return ApiPromise.create({ provider, noInitWarn: true }); })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Native relayer connection timeout')), 15000); })]);
        return new NativeRelayDriver(api, signer);
    }
    catch (e) {
        await provider.disconnect();
        throw e;
    }
    finally {
        clearTimeout(timer);
    } }
    async verifyRollback(j:RelayJournal,deployment:{escrow:Address;token:Address}){return verifyNativeRollback(this.api,this,j,deployment);}
    async disconnect() { await this.api.disconnect(); }
    private async context() {
        const a = this.api, head = await a.rpc.chain.getFinalizedHead(), at: any = await a.at(head), header = await a.rpc.chain.getHeader(head), version = await a.rpc.state.getRuntimeVersion(head), props = await a.rpc.system.properties();
        requireThat(a.genesisHash.toHex() === V3_GENESIS && Number((a.consts as any).revive.chainId.toString()) === 420420777 && version.specName.toString() === 'portaldot-v3' && version.specVersion.toNumber() === 3002 && props.tokenDecimals.unwrapOrDefault()[0].toNumber() === 14, 'relay_runtime_identity_mismatch', undefined, 503);
        const timestamp = Number((await at.query.timestamp.now()).toString());
        requireThat(Math.abs(Date.now() - timestamp) < 180000, 'relay_finality_stale', undefined, 503);
        const relayer = (await at.call.reviveApi.address(this.signer.address)).toString().toLowerCase() as Address, inverse = (await at.call.reviveApi.accountId(relayer)).toString();
        requireThat(inverse === this.signer.address, 'relay_native_mapping_mismatch', undefined, 503);
        return { head, at, header, timestamp, relayer };
    }
    private async read(at: any, to: Address, abi: any, functionName: string, args: readonly unknown[] = []) { const r = await at.call.reviveApi.call(this.signer.address, to, 0, null, null, encodeFunctionData({ abi, functionName, args })); requireThat(r.result.isOk, 'relay_native_read_failed', undefined, 503); const ok = r.result.asOk, ret = ok.result ?? ok; requireThat(BigInt(ret.flags.bits.toString()) === 0n, 'relay_native_read_reverted', undefined, 503); return decodeFunctionResult({ abi, functionName, data: ret.data.toHex() }); }
    async quote(x: {
        account: Address;
        owner: Address;
    }) {
        const c = await this.context(), code = await c.at.call.reviveApi.code(x.account), runtime = '0x' + Buffer.from(compactStripLength(code.toU8a(true))[1]).toString('hex');
        requireThat(runtime === compactRuntime(x.owner), 'relay_account_runtime_mismatch', undefined, 409);
        requireThat(String(await this.read(c.at, x.account, ownerAbi, 'owner')).toLowerCase() === x.owner.toLowerCase(), 'relay_account_owner_mismatch', undefined, 409);
        const storage = await c.at.call.reviveApi.getStorage(x.account, '0x' + '00'.repeat(32));
        requireThat(storage.isOk, 'relay_nonce_unavailable');
        const nonce = storage.asOk.isNone ? '0' : BigInt(storage.asOk.unwrap().toHex()).toString(), info: any = await c.at.query.system.account(this.signer.address), free = BigInt(info.data.free.toString()), frozen = BigInt(info.data.frozen.toString()), ed = BigInt((this.api.consts as any).balances.existentialDeposit.toString()), held = frozen > ed ? frozen : ed;
        return { nonce, relayer: c.relayer, payerNative: this.signer.address, spendable: String(free > held ? free - held : 0n) };
    }
    async readSnapshot(account: Address, escrow: Address, quoteId: Hex): Promise<RelaySnapshot> { const c = await this.context(); const [q, share, contribution, credit] = await Promise.all([this.read(c.at, escrow, relayPlannerAbi, 'getQuote', [quoteId]), this.read(c.at, escrow, relayPlannerAbi, 'shares', [quoteId, account]), this.read(c.at, escrow, relayPlannerAbi, 'contributions', [quoteId, account]), this.read(c.at, escrow, relayPlannerAbi, 'credits', [quoteId, account])]); const [quote, state, held, members] = q as any; return { quote, state: Number(state), held, members, share: share as bigint, contribution: contribution as bigint, credit: credit as bigint, timestamp: BigInt(Math.floor(c.timestamp / 1000)) }; }
    async readProtectedSnapshot(account: Address, escrow: Address, quoteId?: Hex): Promise<ProtectedRelaySnapshot> {
        const context = await this.context();
        const [token, merchantNonce, credit] = await Promise.all([
            this.read(context.at, escrow, protectedRelayAbi, 'token', []),
            this.read(context.at, escrow, protectedRelayAbi, 'merchantNonce', [account]),
            this.read(context.at, escrow, protectedRelayAbi, 'credits', [account]),
        ]);
        const booking = quoteId
            ? await this.read(context.at, escrow, protectedRelayAbi, 'booking', [quoteId]) as ProtectedRelayBooking
            : undefined;
        const positions = booking ? await Promise.all(booking.members.map(async member => {
            const position = await this.read(context.at, escrow, protectedRelayAbi, 'positions', [quoteId, member]) as readonly [bigint, bigint, bigint, boolean, boolean];
            return {account: member, share: position[0], paid: position[1], disputed: position[3], settled: position[4]};
        })) : [];
        return {timestamp: BigInt(Math.floor(context.timestamp / 1000)), token: token as Address,
            merchantNonce: merchantNonce as bigint, credit: credit as bigint, booking, positions};
    }
    async prepare(r: SignedRelayRequest): Promise<RelayPrepared> {
        const identity = await this.quote({ account: r.account, owner: r.owner });
        requireThat(r.chainId === 420420777 && identity.nonce === r.nonce && identity.relayer === r.relayer && BigInt(r.deadline) > BigInt(Math.floor(Date.now() / 1000)), 'relay_authorization_changed', undefined, 409);
        requireThat((await recoverTypedDataAddress({ ...relayAuthorization(r), signature: r.signature })).toLowerCase() === r.owner.toLowerCase(), 'relay_invalid_owner_signature', undefined, 403);
        const data = relayExecution(r), result: any = await (this.api.call as any).reviveApi.call(this.signer.address, r.account, 0, null, null, data);
        if (result.result.isErr) {
            const error = result.result.asErr;
            const reason = error.isModule ? this.api.registry.findMetaError(error.asModule).name : error.toString();
            throw Error('Whole execution simulation failed: ' + reason);
        }
        const ok = result.result.asOk, ret = ok.result ?? ok;
        requireThat(BigInt(ret.flags.bits.toString()) === 0n, 'relay_complete_execution_reverted', undefined, 409);
        const charge = (v: any) => v?.isCharge ? BigInt(v.asCharge.toString()) : 0n;
        const storage = charge(result.maxStorageDeposit) > charge(result.storageDeposit) ? charge(result.maxStorageDeposit) : charge(result.storageDeposit), weight = { refTime: String(BigInt(result.weightRequired.refTime.toString()) * 120n / 100n), proofSize: String(BigInt(result.weightRequired.proofSize.toString()) * 120n / 100n) };
        const tx = (this.api.tx as any).revive.call(r.account, 0, weight, storage.toString(), data), fee = BigInt((await tx.paymentInfo(this.signer.address)).partialFee.toString()) * 120n / 100n;
        requireThat(fee <= BigInt(r.maxFee) && storage <= BigInt(r.maxStorage) && fee + storage <= BigInt(identity.spendable), 'relay_cost_or_funds_exceeded', undefined, 409);
        return { fee: String(fee), storage: String(storage), methodHash: keccak256(tx.method.toHex()), method: tx.method.toHex(), createdAt: Date.now() };
    }
    async sign(p: RelayPrepared) { await this.context(); requireThat(Date.now() - p.createdAt < 120000, 'relay_prepared_expired'); const tx = this.api.tx(p.method), nonce = Number((await this.api.rpc.system.accountNextIndex(this.signer.address)).toString()), startBlock = (await this.api.rpc.chain.getHeader()).number.toNumber(); const currentFee = BigInt((await tx.paymentInfo(this.signer.address)).partialFee.toString()); requireThat(currentFee <= BigInt(p.fee), 'relay_fee_changed_before_signing'); const signed = await this.signer.sign(tx, nonce); requireThat(signed.isSigned && signed.signer.toString() === this.signer.address, 'relay_signer_returned_wrong_identity'); requireThat(keccak256(signed.method.toHex()) === p.methodHash && signed.nonce.toNumber() === nonce, 'relay_signed_transaction_changed'); return { hash: signed.hash.toHex() as Hex, signed: signed.toHex() as Hex, nonce, startBlock, methodHash: p.methodHash, payerNative: this.signer.address }; }
    async broadcast(signed: Hex) { return (await this.api.rpc.author.submitExtrinsic(signed)).toHex() as Hex; }
    async reconcile(j: RelayJournal) {
        await this.context();
        requireThat(j.payerNative === this.signer.address, 'relay_receipt_payer_changed');
        const last = (await this.api.rpc.chain.getHeader(await this.api.rpc.chain.getFinalizedHead())).number.toNumber();
        if (!j.blockNumber && last - j.startBlock > this.scanLimit)
            return { status: 'unknown' as const, settlementKnown: false };
        const start = j.blockNumber ? Number(j.blockNumber) : (j as RelayJournal & {scanFrom?: number}).scanFrom ?? j.startBlock;requireThat(Number.isSafeInteger(start)&&start>=0,'relay_invalid_scan_block');
        for (let n = start; n <= Math.min(last, j.blockNumber?start:start+49); n++) {
            const hash = await this.api.rpc.chain.getBlockHash(n), block = await this.api.rpc.chain.getBlock(hash), index = block.block.extrinsics.findIndex(x => x.hash.toHex() === j.hash);
            if (index < 0)
                continue;
            const tx = block.block.extrinsics[index];
            requireThat(tx.isSigned && tx.signer.toString() === j.payerNative && tx.method.section === 'revive' && tx.method.method === 'call' && keccak256(tx.method.toHex()) === j.methodHash && tx.method.args[0].toString().toLowerCase() === j.compactAccount.toLowerCase() && BigInt(tx.method.args[1].toString()) === 0n && keccak256(tx.method.args[4].toHex()) === j.callHash, 'relay_receipt_call_mismatch', undefined, 409);
            const at = await this.api.at(hash), all: any = await at.query.system.events(), events = all.filter((e: any) => e.phase.isApplyExtrinsic && e.phase.asApplyExtrinsic.toNumber() === index).map((e: any) => e.event), success = events.some((e: any) => e.section === 'system' && e.method === 'ExtrinsicSuccess'), failure = events.some((e: any) => e.section === 'system' && e.method === 'ExtrinsicFailed');
            requireThat(success || failure, 'relay_dispatch_unknown');
            return { status: success ? 'finalized' as const : 'failed' as const, ...nativeReceiptCosts(events, j.payerNative), calls: decodeRelayExecution(tx.method.args[4].toHex()).calls, blockNumber: String(n), blockHash: hash.toHex() };
        }
        return { status: 'unknown' as const, settlementKnown: false, scannedThrough: Math.min(last, j.blockNumber?start:start+49) };
    }
}
