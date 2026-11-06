import {verifyAcceptanceAction} from './acceptance.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, sep, isAbsolute } from 'node:path';
import { address, positive, requireThat } from '../lib.js';
import type { Database } from '../db/database.js';
import { CompactRelay, type RelayJournal } from './compact-relay.js';
import { NativeRelayDriver } from './native-driver.js';
/** Opt-in operator setup only. This function never creates/funds a key or deploys a contract. */
export async function configureCompactRelay(db: Database) {
    if (process.env.COMPACT_RELAY_ENABLED !== 'true')
        return null;
    const keyFile = process.env.COMPACT_RELAY_SIGNER_FILE, policyFile = process.env.COMPACT_RELAY_POLICY_FILE;
    requireThat(keyFile && policyFile && isAbsolute(keyFile) && isAbsolute(policyFile), 'relay_absolute_operator_files_required');
    const projectRoot = fileURLToPath(new URL('../../', import.meta.url)), keyRelative = relative(projectRoot, keyFile);
    requireThat(keyRelative.startsWith('..' + sep) || isAbsolute(keyRelative), 'relay_signer_file_must_be_outside_project');
    const policy = JSON.parse(await readFile(policyFile, 'utf8'));
    requireThat(Array.isArray(policy.merchantOwners) && policy.merchantOwners.length > 0, 'relay_approved_merchants_required');
    const merchantOwners = policy.merchantOwners.map((v: unknown) => address(v) as `0x${string}`), maxGlobalDay = positive(policy.maxGlobalDay);
    const feeCap = positive(policy.feeCap), storageCap = positive(policy.storageCap), maxPerAccountDay = positive(policy.maxPerAccountDay), maxPerRoomDay = positive(policy.maxPerRoomDay), escrow = address(policy.escrow) as `0x${string}`, token = address(policy.token) as `0x${string}`;
    const actionCaps: Record<string, {
        feeCap: string;
        storageCap: string;
    }> = {};
    const maxPerRoom = positive(policy.maxPerRoom ?? maxPerRoomDay);
    for (const [kind, cap] of Object.entries(policy.actionCaps ?? {})) {
        requireThat(['publish', 'payment', 'merchant-payout', 'refund', 'cancel'].includes(kind), 'relay_policy_action_invalid');
        const value = cap as Record<string, unknown>;
        actionCaps[kind] = { feeCap: positive(value.feeCap), storageCap: positive(value.storageCap) };
        requireThat(BigInt(actionCaps[kind].feeCap) + BigInt(actionCaps[kind].storageCap) <= BigInt(maxPerAccountDay), 'relay_action_caps_invalid');
    }
    requireThat(BigInt(feeCap) + BigInt(storageCap) <= BigInt(maxPerAccountDay) && BigInt(maxPerAccountDay) <= BigInt(maxPerRoomDay), 'relay_policy_caps_invalid');
    requireThat(BigInt(maxPerRoomDay) <= BigInt(maxPerRoom), 'relay_booking_cap_invalid');
    const [{ Keyring }, { cryptoWaitReady }] = await Promise.all([import('@polkadot/keyring'), import('@polkadot/util-crypto')]);
    await cryptoWaitReady();
    const uri = (await readFile(keyFile, 'utf8')).trim(), pair = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(uri);
    const driver = await NativeRelayDriver.connect(process.env.NATIVE_RPC ?? 'wss://test-node-v3.portaldot.dev', { address: pair.address, sign: async (tx, nonce) => tx.signAsync(pair, { nonce }) });
    let accepted = false;
    const acceptanceFile = process.env.COMPACT_RELAY_ACCEPTANCE_FILE;
    if (acceptanceFile) {
        requireThat(isAbsolute(acceptanceFile), 'relay_acceptance_absolute_path_required');
        const proof = JSON.parse(await readFile(acceptanceFile, 'utf8'));
        requireThat(proof.schema === 'pactpay-native-relay-acceptance-v1' && Array.isArray(proof.executions), 'relay_acceptance_schema_invalid');
        const actions = new Set<string>();
        for (const e of proof.executions) {
            const identity = await driver.quote({ account: address(e.journal.compactAccount) as `0x${string}`, owner: address(e.journal.owner) as `0x${string}` });
            requireThat(identity.payerNative === e.journal.payerNative, 'relay_acceptance_wrong_signer');
            if(e.kind==='rollback'){await driver.quote({account:address(e.journal.compactAccount) as `0x${string}`,owner:address(e.journal.owner) as `0x${string}`});await driver.verifyRollback(e.journal as RelayJournal,{escrow,token});actions.add('rollback');continue;}
            const result = await driver.reconcile(e.journal as RelayJournal);
            requireThat(result.status === 'finalized' && result.settlementKnown, 'relay_acceptance_not_finalized');
            requireThat(result.calls,'relay_acceptance_calls_missing');const action=verifyAcceptanceAction(e.kind,result.calls,{account:address(e.journal.compactAccount) as `0x${string}`,escrow,token});if(action){const snapshot=await driver.readSnapshot(address(e.journal.compactAccount) as `0x${string}`,escrow,action.quoteId);requireThat(snapshot.share===action.approved&&snapshot.quote.termsHash===action.termsHash,'relay_acceptance_exact_share_mismatch');}actions.add(e.kind);
        }
        accepted = ['publish', 'payment', 'merchant-payout', 'refund', 'cancel','rollback'].every(action => actions.has(action)) && process.env.INDEXER_SOURCE === 'native' && !!process.env.NATIVE_RPC && process.env.INDEXER_ESCROW?.toLowerCase() === escrow && /^\d+$/.test(process.env.INDEXER_START ?? '');
    }
    return { relay: new CompactRelay(db, { driver, escrow, token, feeCap, storageCap, maxPerAccountDay, maxPerRoomDay, maxPerRoom, maxGlobalDay, merchantOwners, actionCaps, accepted }), close: () => driver.disconnect() };
}
