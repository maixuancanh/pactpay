import type { Database } from "../db/database.js";
import { Rooms } from "../rooms/service.js";
import { requireThat } from "../lib.js";
export async function syncAccount(db: Database, rooms: Rooms, userId: string, after?: string) {
  let cursor: [string, string, string, number] | null = null;
  if (after) {
    try { cursor = JSON.parse(Buffer.from(after, 'base64url').toString()); } catch {}
    requireThat(Array.isArray(cursor) && cursor.length === 4 && /^\d+$/.test(cursor[0]) && /^\d+$/.test(cursor[1]) && /^0x[0-9a-f]{64}$/.test(cursor[2]) && Number.isSafeInteger(cursor[3]) && cursor[3]>=0, 'invalid_sync_cursor');
  }
  const list = await rooms.list(userId);
  const rows = (
    await db.query(
      `SELECT e.* FROM chain_events e JOIN quote_bindings q ON q.chain_id=e.chain_id AND q.escrow=e.escrow AND q.quote_id=e.quote_id JOIN rooms r ON r.id=q.room_id WHERE (r.merchant_id=$1 OR r.id IN(SELECT room_id FROM room_members WHERE user_id=$1)) AND ($2::numeric IS NULL OR (e.block_number::numeric,e.chain_id,e.tx_hash,e.log_index)>($2::numeric,$3::bigint,$4::text,$5::int)) ORDER BY e.block_number::numeric,e.chain_id,e.tx_hash,e.log_index LIMIT 1001`,
      [userId, ...(cursor ?? [null,null,null,null])],
    )
  ).rows;
  const events=rows.slice(0,1000), last=events.at(-1);
  const nextCursor=rows.length>1000 && last ? Buffer.from(JSON.stringify([last.block_number,String(last.chain_id),last.tx_hash,last.log_index])).toString('base64url') : null;
  const coverage = (
    await db.query(
      "SELECT stream,chain_id,block_number,block_hash,coverage,updated_at FROM indexer_cursors",
    )
  ).rows;
  const attempts = (
    await db.query(
      "SELECT * FROM payment_attempts WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",
      [userId],
    )
  ).rows;
  const relayIntents=(await db.query("SELECT id,room_id,kind,COALESCE(journal->>'receiptStatus',status) AS status,tx_hash,actual_execution,actual_storage,(journal->>'receiptStatus' IS NOT NULL AND status IN ('submitted','unknown')) AS settlement_pending,updated_at FROM compact_relay_intents WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",[userId])).rows;
  return {
    relayIntents,
    rooms: list,
    events,
    nextCursor,
    attempts,
    coverage: coverage.length
      ? coverage
      : [
          {
            status: "unknown",
            reason: "Indexer not configured or not yet synced",
          },
        ],
  };
}
