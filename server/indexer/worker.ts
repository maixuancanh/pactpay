import type { Database, Sql, Row } from "../db/database.js";
import { address, hex32, id, requireThat } from "../lib.js";
import { enqueue } from "../notifications/worker.js";
export type ChainEvent = {
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  blockHash: string;
  escrow: string;
  quoteId: string;
  kind: string;
  payload: Row;
  source: string;
  coverage: Row;
  contractVersion?: "V1" | "V2";
};
export type FinalizedPage = {
  chainId: number;
  from: string;
  to: string;
  blockHash: string;
  events: ChainEvent[];
  coverage: Row;
};
export interface ChainReader {
  readFinalized(from: bigint, limit: number): Promise<FinalizedPage>;
}
export async function ingestEvent(tx: Sql, e: ChainEvent) {
  hex32(e.txHash);
  hex32(e.blockHash);
  hex32(e.quoteId);
  address(e.escrow);
  requireThat(
    /^\d+$/.test(e.blockNumber) &&
      Number.isSafeInteger(e.logIndex) &&
      e.logIndex >= 0,
    "invalid_event",
  );
  const result = await tx.query(
    `INSERT INTO chain_events(chain_id,tx_hash,log_index,block_number,block_hash,escrow,quote_id,kind,payload,source,coverage,contract_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(chain_id,tx_hash,log_index) DO NOTHING RETURNING tx_hash`,
    [
      e.chainId,
      e.txHash.toLowerCase(),
      e.logIndex,
      e.blockNumber,
      e.blockHash.toLowerCase(),
      e.escrow.toLowerCase(),
      e.quoteId.toLowerCase(),
      e.kind,
      JSON.stringify(e.payload),
      e.source,
      JSON.stringify(e.coverage),
      e.contractVersion ?? "V1",
    ],
  );
  if (!result.rows.length) return;
  if (e.contractVersion === "V2") return; // V2 evidence never runs the V1 room/credit state machine.
  if (e.kind === "QuoteCreated") {
    const intent = (
      await tx.query(
        "SELECT * FROM payment_intents WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 FOR UPDATE",
        [e.chainId, e.escrow.toLowerCase(), e.quoteId.toLowerCase()],
      )
    ).rows[0];
    if (!intent) return;
    const r = (
      await tx.query("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
        intent.room_id,
      ])
    ).rows[0];
    requireThat(
      intent.terms_hash === e.payload.termsHash &&
        r.terms_hash === intent.terms_hash &&
        r.revision === intent.revision &&
        r.total === String(e.payload.total),
      "chain_quote_mismatch",
      undefined,
      409,
    );
    if (["evm-rpc-finalized","native-rpc-finalized"].includes(e.source)) {
      const members = (
        await tx.query(
          "SELECT account_address,share FROM room_members WHERE room_id=$1 ORDER BY user_id",
          [r.id],
        )
      ).rows;
      requireThat(
        Array.isArray(e.payload.verifiedMembers) &&
          Array.isArray(e.payload.verifiedShares) &&
          e.payload.verifiedMembers.length === members.length,
        "chain_roster_missing",
      );
      for (let index = 0; index < members.length; index++)
        requireThat(
          e.payload.verifiedMembers[index].toLowerCase() ===
            members[index].account_address &&
            String(e.payload.verifiedShares[index]) === members[index].share,
          "chain_roster_mismatch",
        );
      requireThat(
        Number(e.payload.captureDeadline) <=
          Math.floor(new Date(r.service_at).getTime() / 1000) &&
          Number(e.payload.captureDeadline) > Number(e.payload.fundingDeadline),
        "chain_capture_deadline_mismatch",
      );
    }
    const merchant = (
      await tx.query(
        "SELECT account_address FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2",
        [r.merchant_id, e.chainId],
      )
    ).rows[0];
    requireThat(
      (r.merchant_account_address??merchant?.account_address) === e.payload.merchant?.toLowerCase(),
      "chain_merchant_mismatch",
    );
    requireThat(
      Math.floor(new Date(r.funding_deadline).getTime() / 1000) ===
        Number(e.payload.fundingDeadline),
      "chain_deadline_mismatch",
    );
    await tx.query(
      `INSERT INTO quote_bindings(room_id,revision,terms_hash,chain_id,escrow,quote_id,tx_hash,block_number,block_hash,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(room_id) DO NOTHING`,
      [
        r.id,
        r.revision,
        r.terms_hash,
        e.chainId,
        e.escrow,
        e.quoteId,
        e.txHash,
        e.blockNumber,
        e.blockHash,
        e.source,
      ],
    );
    await tx.query(
      "UPDATE payment_intents SET status='finalized',tx_hash=$2 WHERE id=$1",
      [intent.id, e.txHash],
    );
    await tx.query("UPDATE rooms SET status='published' WHERE id=$1", [r.id]);
    await tx.query(
      "UPDATE inventory_holds SET status='funding' WHERE room_id=$1 AND status='draft'",
      [r.id],
    );
    for (const m of (
      await tx.query("SELECT user_id FROM room_members WHERE room_id=$1", [
        r.id,
      ])
    ).rows)
      await enqueue(tx, m.user_id, r.id, "payment-open", r.revision);
  }
  const q = (
    await tx.query(
      "SELECT q.*,r.revision,r.merchant_id FROM quote_bindings q JOIN rooms r ON r.id=q.room_id WHERE q.chain_id=$1 AND q.escrow=$2 AND q.quote_id=$3",
      [e.chainId, e.escrow, e.quoteId],
    )
  ).rows[0];
  if (!q) return;
  await tx.query(
    "UPDATE payment_attempts SET status='finalized',updated_at=now() WHERE chain_id=$1 AND tx_hash=$2",
    [e.chainId, e.txHash],
  );
  await tx.query(
    `INSERT INTO merchant_webhook_outbox(id,merchant_id,event_key,payload) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING`,
    [
      id(),
      q.merchant_id,
      `${e.chainId}:${e.txHash}:${e.logIndex}`,
      JSON.stringify({
        type: "chain-event-finalized",
        contractVersion: "V1",
        chainId: e.chainId,
        escrow: e.escrow,
        quoteId: e.quoteId,
        txHash: e.txHash,
        logIndex: e.logIndex,
        blockNumber: e.blockNumber,
        blockHash: e.blockHash,
        kind: e.kind,
        data: e.payload,
      }),
    ],
  );
  if (e.kind === "StateChanged") {
    const state = Number(e.payload.state);
    if (state === 3)
      await tx.query(
        "UPDATE inventory_holds SET status='confirmed' WHERE room_id=$1 AND status<>'released'",
        [q.room_id],
      );
    if ([4, 5].includes(state)) {
      await tx.query(
        "UPDATE inventory_holds SET status='released' WHERE room_id=$1",
        [q.room_id],
      );
      await tx.query(
        "UPDATE outbox SET status='cancelled' WHERE room_id=$1 AND kind LIKE 'funding-%' AND status<>'delivered'",
        [q.room_id],
      );
      for (const m of (
        await tx.query("SELECT user_id FROM room_members WHERE room_id=$1", [
          q.room_id,
        ])
      ).rows)
        await enqueue(tx, m.user_id, q.room_id, "claim-check", q.revision, {
          finalizedBlock: e.blockNumber,
        });
    }
  }
}
export async function runIndexer(
  db: Database,
  stream: string,
  chainId: number,
  deploymentStart: bigint,
  reader: ChainReader,
  limit = 250,
) {
  // Read provider outside DB lock; compare cursor under lock before commit for competing workers.
  const old = (
    await db.query("SELECT * FROM indexer_cursors WHERE stream=$1", [stream])
  ).rows[0];
  const from = old ? BigInt(old.block_number) + 1n : deploymentStart;
  const page = await reader.readFinalized(from, limit);
  requireThat(!old||Number(old.chain_id)===chainId,'indexer_cursor_chain_changed');
  requireThat(!old?.coverage?.source||!page.coverage.source||old.coverage.source===page.coverage.source,'indexer_cursor_source_changed','Rebuild a separately audited index before switching native/EVM sources',409);
  requireThat(
    page.chainId === chainId &&
      BigInt(page.from) === from &&
      BigInt(page.to) >= from,
    "invalid_indexer_page",
  );
  hex32(page.blockHash);
  requireThat(
    page.events.every(
      (e) =>
        e.chainId === chainId &&
        BigInt(e.blockNumber) >= from &&
        BigInt(e.blockNumber) <= BigInt(page.to),
    ),
    "event_outside_page",
  );
  return db.transaction(async (tx) => {
    await tx.query("LOCK TABLE indexer_cursors IN EXCLUSIVE MODE");
    const current = (
      await tx.query("SELECT * FROM indexer_cursors WHERE stream=$1", [stream])
    ).rows[0];
    if ((current?.block_number ?? null) !== (old?.block_number ?? null))
      return { advanced: false, reason: "another-worker-advanced" };
    for (const event of page.events) await ingestEvent(tx, event);
    await tx.query(
      `INSERT INTO indexer_cursors(stream,chain_id,block_number,block_hash,coverage) VALUES($1,$2,$3,$4,$5) ON CONFLICT(stream) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,coverage=EXCLUDED.coverage,updated_at=now()`,
      [stream, chainId, page.to, page.blockHash, JSON.stringify(page.coverage)],
    );
    return { advanced: true, to: page.to };
  });
}
