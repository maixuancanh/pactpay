import { recoverTypedDataAddress, keccak256, hashTypedData, type Address, type Hex } from 'viem';
import type { Database, Row } from '../db/database.js';
import { id, text, requireThat, hex32, canonical, hash } from '../lib.js';
import { Rooms } from '../rooms/service.js';
import { SponsorBudget } from './budget.js';
import type { SponsorPolicy } from './policy.js';
import { buildRelayPlan, type RelayAction, type RelaySnapshot } from './compact-planner.js';
import { relayAuthorization, relayExecution, type RelayRequest, type SignedRelayRequest } from './compact-codec.js';
import {buildProtectedRelayPlan, type ProtectedRelaySnapshot} from './protected-planner.js';
import {protectedRooms, type ProtectedConfig} from '../payments/protected-rooms.js';
export type RelayPrepared = {
    fee: string;
    storage: string;
    methodHash: Hex;
    [key: string]: any;
};
export type RelayJournal = {
    hash: Hex;
    nonce: number;
    startBlock: number;
    methodHash: Hex;
    payerNative: string;
    compactAccount: Address;
    owner: Address;
    callHash: Hex;
    blockNumber?:string;
};
export interface RelayDriver {
    quote(x: {
        account: Address;
        owner: Address;
    }): Promise<{
        nonce: string;
        relayer: Address;
        payerNative: string;
        spendable: string;
    }>;
    readSnapshot(account: Address, escrow: Address, quoteId: Hex): Promise<RelaySnapshot>;
    readProtectedSnapshot?(account: Address, escrow: Address, quoteId?: Hex): Promise<ProtectedRelaySnapshot>;
    prepare(request: SignedRelayRequest): Promise<RelayPrepared>;
    sign(prepared: RelayPrepared): Promise<{
        hash: Hex;
        signed: Hex;
        nonce: number;
        startBlock: number;
        methodHash: Hex;
        payerNative: string;
    }>;
    broadcast(signed: Hex): Promise<Hex>;
    reconcile(journal: RelayJournal): Promise<{
        status: 'finalized' | 'failed' | 'unknown';
        actualFee?: string;
        actualStorage?: string | null;
        settlementKnown: boolean;
        scannedThrough?: number;
        blockNumber?: string;
        blockHash?: string;
    }>;
}
export type CompactRelayConfig = {
    protectedDeployment?: ProtectedConfig;
    driver: RelayDriver;
    escrow: Address;
    token: Address;
    feeCap: string;
    storageCap: string;
    maxPerAccountDay: string;
    maxPerRoomDay: string;
    maxPerRoom?: string;
    actionCaps?: Partial<Record<RelayAction, {
        feeCap: string;
        storageCap: string;
    }>>;
    maxGlobalDay?: string;
    merchantOwners?: Address[];
    accepted: boolean;
};
const active = ['quoted', 'submitting', 'submitted', 'unknown'];
const view = (r: Row) => ({ reviewLabel: r.binding?.reviewLabel, id: r.id, status: r.journal?.receiptStatus ?? r.status, settlementPending: !!r.journal?.receiptStatus && ['submitted', 'unknown'].includes(r.status), kind: r.kind, ...r.request, binding: r.binding, txHash: r.tx_hash ?? undefined, actualExecution: r.actual_execution ?? undefined, actualStorage: r.actual_storage ?? undefined, error: r.error ?? undefined });
/** Durable hashes/state only. Owner signatures and signed extrinsic bytes remain in request memory. */
export class CompactRelay {
    private rooms: Rooms;
    private budgets: SponsorBudget;
    constructor(private db: Database, private c: CompactRelayConfig) { this.rooms = new Rooms(db, 420420777); const policy: SponsorPolicy = { chainId: 420420777, contracts: { [c.escrow]: ['publish', 'payment', 'merchant-payout', 'refund', 'cancel'] }, maxPerAction: String(Object.values(c.actionCaps ?? {}).reduce((largest, cap) => { const sum = BigInt(cap!.feeCap) + BigInt(cap!.storageCap); return sum > largest ? sum : largest; }, BigInt(c.feeCap) + BigInt(c.storageCap))), maxPerAccountDay: c.maxPerAccountDay, maxPerRoomDay: c.maxPerRoomDay, maxPerRoom: c.maxPerRoom, enabled: c.accepted }; this.budgets = new SponsorBudget(db, policy); }
    get available() { return this.c.accepted; }
    private matchesVersion(room: Row) {
        return (room.settlementVersion === 'protected-v2') === !!this.c.protectedDeployment;
    }
    private async plan(room: Row, account: Address, action: RelayAction, expiresAt: number) {
        requireThat(this.matchesVersion(room), 'relay_version_mismatch', undefined, 409);
        if (this.c.protectedDeployment) {
            requireThat(this.c.driver.readProtectedSnapshot, 'relay_protected_reader_required');
            const snapshot = await this.c.driver.readProtectedSnapshot!(account, this.c.escrow, room.protectedBooking?.quoteId);
            return buildProtectedRelayPlan({room, account, action, escrow: this.c.escrow, token: this.c.token,
                snapshot, now: Date.now(), expiresAt});
        }
        const snapshot = action === 'publish' ? undefined :
            await this.c.driver.readSnapshot(account, this.c.escrow, room.quote?.quoteId);
        return buildRelayPlan({room, account, action, escrow: this.c.escrow, token: this.c.token,
            snapshot, now: Date.now(), expiresAt});
    }
    private async row(userId: string, roomId: string, intentId: string) { const room=await this.rooms.get(userId,roomId); requireThat(this.matchesVersion(room),'relay_version_mismatch'); const r = (await this.db.query('SELECT * FROM compact_relay_intents WHERE id=$1 AND room_id=$2 AND user_id=$3', [intentId, roomId, userId])).rows[0]; requireThat(r, 'relay_intent_not_found', undefined, 404); return r; }
    private async budget(room: Row) { if (this.c.merchantOwners) {
        const owner = (await this.db.query('SELECT owner_address FROM wallet_bindings WHERE user_id=$1 AND chain_id=420420777', [room.merchantId])).rows[0]?.owner_address;
        if (!owner || !this.c.merchantOwners.includes(owner))
            return null;
    } return (await this.db.query("SELECT * FROM sponsorship_budgets WHERE merchant_id=$1 AND enabled=true ORDER BY id LIMIT 1", [room.merchantId])).rows[0]; }
    async status(userId: string, roomId: string) { const room = await this.rooms.get(userId, roomId); await this.expire(); const budget = await this.budget(room), r = (await this.db.query("SELECT * FROM compact_relay_intents WHERE user_id=$1 AND room_id=$2 AND status IN ('quoted','submitting','submitted','unknown') AND journal->>'receiptStatus' IS NULL ORDER BY created_at DESC LIMIT 1", [userId, roomId])).rows[0]; const control = (await this.db.query('SELECT enabled FROM compact_relay_control WHERE id=1')).rows[0]; return { available: this.available && this.matchesVersion(room) && !!budget && !!control?.enabled, reason: !this.matchesVersion(room) ? 'This fee service does not support this booking version.' : !control?.enabled ? 'Sponsorship is paused by the operator.' : !this.available ? 'Automatic sponsorship is awaiting configured signer and verified V3 acceptance.' : !budget ? 'The merchant has not enabled a sponsorship budget.' : undefined, budget: budget ? { remaining: String(BigInt(budget.cap) - BigInt(budget.spent) - BigInt(budget.reserved)) } : undefined, activeIntent: r ? view(r) : undefined }; }
    async create(userId: string, roomId: string, raw: Row) {
        requireThat(this.available, 'relay_unavailable', undefined, 503);
        const kind = text(raw.kind, 30) as RelayAction;
        requireThat(['publish', 'payment', 'merchant-payout', 'refund', 'cancel'].includes(kind), 'relay_action_invalid');
        const key = userId + ':' + text(raw.idempotencyKey, 300), caps = this.c.actionCaps?.[kind] ?? this.c;
        const existing = (await this.db.query('SELECT * FROM compact_relay_intents WHERE idempotency_key=$1', [key])).rows[0];
        if (existing) {
            requireThat(existing.user_id === userId && existing.room_id === roomId && existing.kind === kind, 'relay_idempotency_conflict', undefined, 409);
            return view(existing);
        }
        const previousReservation = (await this.db.query('SELECT status FROM sponsorship_reservations WHERE idempotency_key=$1', [key])).rows[0];
        requireThat(!previousReservation || previousReservation.status === 'reserved', 'relay_reservation_already_closed', undefined, 409);
        await this.expire();
        const room = await this.rooms.get(userId, roomId), merchant = room.merchantId === userId;
        requireThat(!['publish', 'merchant-payout', 'cancel'].includes(kind) || merchant, 'relay_merchant_required', undefined, 403);
        const registration = (await this.db.query('SELECT * FROM atomic_accounts WHERE user_id=$1 AND chain_id=420420777', [userId])).rows[0];
        requireThat(registration, 'relay_registered_account_required', undefined, 409);
        const actor = merchant && ['publish', 'merchant-payout', 'cancel'].includes(kind) ? room.merchantAccountAddress : room.members.find((m: Row) => m.userId === userId)?.accountAddress;
        requireThat(actor === registration.account_address, 'relay_room_account_mismatch', undefined, 409);
        const account = actor as Address, owner = registration.owner_address as Address, identity = await this.c.driver.quote({ account, owner });
        requireThat(BigInt(identity.spendable) >= BigInt(caps.feeCap) + BigInt(caps.storageCap), 'relay_native_funds_insufficient', undefined, 409);
        const expiresAt = Date.now() + 120000, plan = await this.plan(room, account, kind, expiresAt);
        const request: RelayRequest = { account, owner, chainId: 420420777, relayer: identity.relayer, nonce: identity.nonce, deadline: String(Math.floor(expiresAt / 1000)), maxFee: caps.feeCap, maxStorage: caps.storageCap, calls: plan.calls };
        const binding = { ...plan.binding, fee: caps.feeCap, storage: caps.storageCap, actionId: 'sponsored:' + hashTypedData(relayAuthorization(request)) };
        const b = await this.budget(room);
        requireThat(b, 'relay_budget_unavailable', undefined, 409);
        const reservation = await this.budgets.reserve(userId, b.id, key, { chainId: 420420777, account, roomId, contract: this.c.escrow, function: kind, amount: String(BigInt(caps.feeCap) + BigInt(caps.storageCap)), recipient: binding.recipient, expiresAt: new Date(expiresAt).toISOString(), nonce: 'relay:' + hash(key) });
        requireThat(reservation.status === 'reserved', 'relay_reservation_already_closed', undefined, 409);
        try {
            return await this.db.transaction(async (tx) => { const reservationState = (await tx.query('SELECT status FROM sponsorship_reservations WHERE id=$1 FOR UPDATE', [reservation.id])).rows[0]; requireThat(reservationState?.status === 'reserved', 'relay_reservation_already_closed', undefined, 409); await tx.query('SELECT id FROM wallet_bindings WHERE user_id=$1 AND chain_id=420420777 FOR UPDATE', [userId]); const same = (await tx.query('SELECT * FROM compact_relay_intents WHERE idempotency_key=$1', [key])).rows[0]; if (same)
                return view(same); const control = (await tx.query('SELECT * FROM compact_relay_control WHERE id=1 FOR UPDATE')).rows[0]; requireThat(control?.enabled, 'relay_circuit_paused', undefined, 503); const daily = (await tx.query("SELECT * FROM compact_relay_intents WHERE created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AND status<>'released'")).rows.reduce((sum, row) => sum + (row.actual_execution !== null && row.actual_storage !== null ? BigInt(row.actual_execution) + BigInt(row.actual_storage) : BigInt(row.request.maxFee) + BigInt(row.request.maxStorage)), 0n); requireThat(daily + BigInt(caps.feeCap) + BigInt(caps.storageCap) <= BigInt(this.c.maxGlobalDay ?? this.c.maxPerRoomDay), 'relay_global_daily_cap', undefined, 409); requireThat(!(await tx.query("SELECT id FROM compact_relay_intents WHERE account_address=$1 AND account_nonce=$2 AND status IN ('quoted','submitting','submitted','unknown')", [account, identity.nonce])).rows.length, 'relay_account_busy', undefined, 409); const row = (await tx.query("INSERT INTO compact_relay_intents(id,user_id,room_id,reservation_id,budget_id,idempotency_key,chain_id,account_address,account_nonce,kind,request,binding,status) VALUES($1,$2,$3,$4,$5,$6,420420777,$7,$8,$9,$10,$11,'quoted') RETURNING *", [id(), userId, roomId, reservation.id, b.id, key, account, identity.nonce, kind, JSON.stringify(request), JSON.stringify(binding)])).rows[0]; return view(row); });
        }
        catch (e) {
            await this.releaseOrphan(reservation.id);
            throw e;
        }
    }
    async get(userId: string, roomId: string, intentId: string) { await this.expire(); const r = await this.row(userId, roomId, intentId); if (['submitted', 'unknown'].includes(r.status) && r.journal)
        await this.reconcile(r); return view(await this.row(userId, roomId, intentId)); }
    async cancel(userId: string, roomId: string, intentId: string) { const r = await this.row(userId, roomId, intentId); await this.releaseQuoted(r); return view(await this.row(userId, roomId, intentId)); }
    private async releaseOrphan(reservationId: string) { await this.db.transaction(async (tx) => { const r = (await tx.query('SELECT * FROM sponsorship_reservations WHERE id=$1 FOR UPDATE', [reservationId])).rows[0]; if (!r || r.status !== 'reserved' || (await tx.query('SELECT id FROM compact_relay_intents WHERE reservation_id=$1', [reservationId])).rows.length)
        return; const b = (await tx.query('SELECT * FROM sponsorship_budgets WHERE id=$1 FOR UPDATE', [r.budget_id])).rows[0]; requireThat(BigInt(b.reserved) >= BigInt(r.amount), 'relay_reserved_accounting_mismatch'); await tx.query('UPDATE sponsorship_budgets SET reserved=$2 WHERE id=$1', [b.id, String(BigInt(b.reserved) - BigInt(r.amount))]); await tx.query("UPDATE sponsorship_reservations SET status='released' WHERE id=$1", [reservationId]); }); }
    private async releaseQuoted(r: Row) { await this.db.transaction(async (tx) => { const current = (await tx.query('SELECT * FROM compact_relay_intents WHERE id=$1 FOR UPDATE', [r.id])).rows[0]; requireThat(current.status === 'quoted', 'relay_already_attempted', undefined, 409); const reservation = (await tx.query('SELECT * FROM sponsorship_reservations WHERE id=$1 FOR UPDATE', [r.reservation_id])).rows[0], b = (await tx.query('SELECT * FROM sponsorship_budgets WHERE id=$1 FOR UPDATE', [r.budget_id])).rows[0]; if (reservation.status !== 'released') {
        requireThat(BigInt(b.reserved) >= BigInt(reservation.amount), 'relay_reserved_accounting_mismatch');
        await tx.query('UPDATE sponsorship_budgets SET reserved=$2 WHERE id=$1', [b.id, String(BigInt(b.reserved) - BigInt(reservation.amount))]);
        await tx.query("UPDATE sponsorship_reservations SET status='released' WHERE id=$1", [reservation.id]);
    } await tx.query("UPDATE compact_relay_intents SET status='released',updated_at=now() WHERE id=$1", [r.id]); }); }
    async submit(userId: string, roomId: string, intentId: string, signature: unknown) {
        requireThat(this.available, 'relay_unavailable', undefined, 503);
        let r = await this.row(userId, roomId, intentId);
        if (r.status !== 'quoted')
            return this.get(userId, roomId, intentId);
        requireThat(typeof signature === 'string' && /^0x[0-9a-f]{130}$/i.test(signature), 'relay_signature_invalid');
        const request = r.request as RelayRequest;
        requireThat(BigInt(request.deadline) > BigInt(Math.floor(Date.now() / 1000)), 'relay_quote_expired');
        requireThat((await recoverTypedDataAddress({ ...relayAuthorization(request), signature: signature as Hex })).toLowerCase() === request.owner.toLowerCase(), 'relay_signature_owner_mismatch', undefined, 403);
        // Fresh server plan must be identical. No browser amount, calls, recipient or caps are trusted.
        const room = await this.rooms.get(userId, roomId);
        const plan = await this.plan(room, request.account, r.kind, r.binding.estimateExpiresAt);
        requireThat(room.revision === r.binding.revision && canonical(plan.calls) === canonical(request.calls), 'relay_plan_changed', undefined, 409);
        if(this.c.protectedDeployment)requireThat(plan.binding.amount===r.binding.amount&&('reviewLabel' in plan.binding?plan.binding.reviewLabel:undefined)===r.binding.reviewLabel,'relay_review_changed',undefined,409);
        const signed = { ...request, signature: signature as Hex }, prepared = await this.c.driver.prepare(signed);
        requireThat(BigInt(prepared.fee) <= BigInt(request.maxFee) && BigInt(prepared.storage) <= BigInt(request.maxStorage), 'relay_cost_exceeds_cap', undefined, 409);
        const publication = r.kind === 'publish' && !this.c.protectedDeployment ? await this.rooms.publish(userId, roomId, { revision: r.binding.revision, idempotencyKey: 'room:' + roomId + ':' + r.binding.revision, chainId: 420420777, escrow: this.c.escrow, quoteId: r.binding.quoteId }) : null;
        const claimed = await this.db.transaction(async (tx) => { const row = (await tx.query('SELECT * FROM compact_relay_intents WHERE id=$1 FOR UPDATE', [r.id])).rows[0]; if (row.status !== 'quoted')
            return false; const control = (await tx.query('SELECT enabled FROM compact_relay_control WHERE id=1')).rows[0]; requireThat(control?.enabled, 'relay_circuit_paused', undefined, 503); const budget = (await tx.query('SELECT * FROM sponsorship_budgets WHERE id=$1 FOR UPDATE', [row.budget_id])).rows[0]; requireThat(budget?.enabled, 'relay_budget_paused', undefined, 409); const signerClaim = await tx.query('INSERT INTO compact_relay_signer_lock(signer,intent_id) VALUES($1,$2) ON CONFLICT(signer) DO NOTHING RETURNING signer', [request.relayer, r.id]); requireThat(signerClaim.rows.length, 'relay_signer_busy', undefined, 409); await tx.query("UPDATE compact_relay_intents SET status='submitting',updated_at=now() WHERE id=$1", [r.id]); await tx.query("UPDATE sponsorship_reservations SET status='unknown' WHERE id=$1", [r.reservation_id]); return true; });
        if (!claimed)
            return this.get(userId, roomId, intentId);
        let broadcastStarted = false;
        try {
            const tx = await this.c.driver.sign(prepared), journal: RelayJournal = { hash: tx.hash, nonce: tx.nonce, startBlock: tx.startBlock, methodHash: tx.methodHash, payerNative: tx.payerNative, compactAccount: request.account, owner: request.owner, callHash: keccak256(relayExecution(signed)) };
            const stored = await this.db.query("UPDATE compact_relay_intents SET status='unknown',tx_hash=$2,journal=$3,updated_at=now() WHERE id=$1 AND status='submitting' RETURNING id", [r.id, hex32(tx.hash), JSON.stringify(journal)]);
            requireThat(stored.rows.length, 'relay_claim_lost_before_broadcast', undefined, 409);
            const dispatchControl=(await this.db.query('SELECT enabled FROM compact_relay_control WHERE id=1')).rows[0],dispatchBudget=(await this.db.query('SELECT enabled FROM sponsorship_budgets WHERE id=$1',[r.budget_id])).rows[0];requireThat(dispatchControl?.enabled&&dispatchBudget?.enabled,'relay_paused_before_broadcast',undefined,409);
            broadcastStarted = true;
            const hash = await this.c.driver.broadcast(tx.signed);
            requireThat(hash.toLowerCase() === tx.hash.toLowerCase(), 'relay_broadcast_hash_mismatch');
            await this.db.query("UPDATE compact_relay_intents SET status='submitted',updated_at=now() WHERE id=$1", [r.id]);
            await this.db.query("UPDATE sponsorship_reservations SET status='submitted',tx_hash=$2 WHERE id=$1", [r.reservation_id, tx.hash]);
        }
        catch {
            if (!broadcastStarted) {
                const reset = await this.db.query("UPDATE compact_relay_intents SET status='quoted',tx_hash=NULL,journal=NULL,error='No broadcast occurred; quote released.',updated_at=now() WHERE id=$1 AND status IN ('submitting','unknown') RETURNING id", [r.id]);
                if (reset.rows.length)
                    await this.releaseQuoted(r);
                await this.db.query('DELETE FROM compact_relay_signer_lock WHERE intent_id=$1', [r.id]);
            }
            else
                await this.db.query("UPDATE compact_relay_intents SET status='unknown',error='Submission requires reconciliation; no automatic resend.',updated_at=now() WHERE id=$1", [r.id]);
        }
        if (broadcastStarted && publication) {
            const saved = await this.row(userId, roomId, intentId);
            if (saved.tx_hash) {
                try {
                    await this.rooms.submitted(userId, roomId, publication.id, saved.tx_hash);
                }
                catch { }
            }
        }
        return view(await this.row(userId, roomId, intentId));
    }
    private async reconcile(r: Row) {
        const proof = await this.c.driver.reconcile(r.journal as RelayJournal);
        if (proof.status === 'unknown' && proof.scannedThrough !== undefined)
            await this.db.query("UPDATE compact_relay_intents SET journal=journal||$2::jsonb WHERE id=$1 AND status IN ('submitted','unknown')", [r.id, JSON.stringify({ scanFrom: proof.scannedThrough + 1 })]);
        if (proof.status !== 'unknown') {if(proof.status==='failed'&&r.kind==='publish')await this.db.query("UPDATE payment_intents SET status='prepared',tx_hash=NULL WHERE room_id=$1 AND revision=$2 AND quote_id=$3 AND tx_hash=$4 AND status<>'finalized'",[r.room_id,r.binding.revision,r.binding.quoteId,r.tx_hash]);
            await this.db.query("UPDATE compact_relay_intents SET journal=journal||$2::jsonb,updated_at=now() WHERE id=$1 AND status IN ('submitted','unknown')", [r.id, JSON.stringify({ receiptStatus: proof.status, blockNumber: proof.blockNumber, blockHash: proof.blockHash })]);
            await this.db.query('DELETE FROM compact_relay_signer_lock WHERE intent_id=$1', [r.id]);
        }
        if (proof.status === 'finalized' && this.c.protectedDeployment) {
            requireThat(proof.blockNumber, 'relay_finalized_block_required');
            const service = protectedRooms(this.db, this.c.protectedDeployment);
            const evidence = {quoteId: r.binding.quoteId, txHash: r.tx_hash,
                blockNumber: proof.blockNumber, revision: r.binding.revision};
            if (r.kind === 'publish') await service.bind(r.user_id, r.room_id, evidence);
            else if (r.kind !== 'cancel') await service.record(r.user_id, r.room_id, evidence);
        }
        if (proof.status === 'unknown' || !proof.settlementKnown || proof.actualFee === undefined || proof.actualStorage === null || proof.actualStorage === undefined)
            return;
        const actual = BigInt(proof.actualFee) + BigInt(proof.actualStorage);
        requireThat(actual >= 0n && actual <= BigInt(r.request.maxFee) + BigInt(r.request.maxStorage), 'relay_actual_cost_outside_cap', undefined, 409);
        await this.db.transaction(async (tx) => { const current = (await tx.query('SELECT * FROM compact_relay_intents WHERE id=$1 FOR UPDATE', [r.id])).rows[0]; if (!['submitted', 'unknown'].includes(current.status))
            return; const reservation = (await tx.query('SELECT * FROM sponsorship_reservations WHERE id=$1 FOR UPDATE', [r.reservation_id])).rows[0], b = (await tx.query('SELECT * FROM sponsorship_budgets WHERE id=$1 FOR UPDATE', [r.budget_id])).rows[0]; requireThat(BigInt(b.reserved) >= BigInt(reservation.amount), 'relay_reserved_accounting_mismatch'); await tx.query('UPDATE sponsorship_budgets SET reserved=$2,spent=$3 WHERE id=$1', [b.id, String(BigInt(b.reserved) - BigInt(reservation.amount)), String(BigInt(b.spent) + actual)]); await tx.query("UPDATE sponsorship_reservations SET status='settled',tx_hash=$2 WHERE id=$1", [reservation.id, r.tx_hash]); await tx.query('UPDATE compact_relay_intents SET status=$2,actual_execution=$3,actual_storage=$4,error=NULL,updated_at=now() WHERE id=$1', [r.id, proof.status, proof.actualFee, proof.actualStorage]); await tx.query('DELETE FROM compact_relay_signer_lock WHERE intent_id=$1', [r.id]); });
    }
    async expire() {
        const stale = (await this.db.query("SELECT * FROM compact_relay_intents WHERE status='submitting' AND journal IS NULL AND updated_at<now()-interval '5 minutes'")).rows;
        for (const row of stale) {
            const reset = await this.db.query("UPDATE compact_relay_intents SET status='quoted' WHERE id=$1 AND status='submitting' AND journal IS NULL RETURNING id", [row.id]);
            if (reset.rows.length) {
                await this.releaseQuoted(row);
                await this.db.query('DELETE FROM compact_relay_signer_lock WHERE intent_id=$1', [row.id]);
            }
        }
        const orphans = (await this.db.query("SELECT r.* FROM sponsorship_reservations r WHERE r.status='reserved' AND r.authorization_data->>'nonce' LIKE 'relay:%' AND (r.authorization_data->>'expiresAt')::timestamptz<now() AND NOT EXISTS(SELECT 1 FROM compact_relay_intents i WHERE i.reservation_id=r.id)")).rows;
        for (const r of orphans)
            await this.releaseOrphan(r.id);
        const rows = (await this.db.query("SELECT * FROM compact_relay_intents WHERE status='quoted' AND (request->>'deadline')::numeric<$1", [String(Math.floor(Date.now() / 1000))])).rows;
        for (const r of rows) {
            try {
                await this.releaseQuoted(r);
            }
            catch { }
        }
    }
    async tick() { await this.expire(); for (const r of (await this.db.query("SELECT i.* FROM compact_relay_intents i JOIN rooms r ON r.id=i.room_id WHERE i.status IN ('submitted','unknown') AND i.journal IS NOT NULL AND r.settlement_version=$1 AND lower(i.binding->>'escrow')=$2 ORDER BY i.created_at LIMIT 20",[this.c.protectedDeployment?'protected-v2':'v1',this.c.escrow.toLowerCase()])).rows) {
        try {
            await this.reconcile(r);
        }
        catch { }
    } }
}
