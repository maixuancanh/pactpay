import type { Database, Sql } from "../db/database.js";
import { id } from "../lib.js";
import { quietNow } from "./policy.js";
export async function enqueue(
  tx: Sql,
  userId: string,
  roomId: string,
  kind: string,
  revision: number,
  payload: Record<string, unknown> = {},
) {
  await tx.query(
    `INSERT INTO outbox(id,user_id,room_id,kind,revision,payload,dedup_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedup_key) DO NOTHING`,
    [
      id(),
      userId,
      roomId,
      kind,
      revision,
      JSON.stringify({ roomId, ...payload }),
      `${userId}:${roomId}:${kind}:${revision}`,
    ],
  );
}
export async function scheduleReminders(db: Database, now = new Date()) {
  await db.transaction(async (tx) => {
    const rooms = (
      await tx.query(
        "SELECT * FROM rooms WHERE status='published' AND funding_deadline>$1",
        [now],
      )
    ).rows;
    for (const r of rooms) {
      const quote = (
        await tx.query("SELECT * FROM quote_bindings WHERE room_id=$1", [r.id])
      ).rows[0];
      if (!quote) continue;
      const terminal = (
        await tx.query(
          "SELECT payload FROM chain_events WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 AND kind='StateChanged' ORDER BY block_number::numeric DESC,log_index DESC LIMIT 1",
          [quote.chain_id, quote.escrow, quote.quote_id],
        )
      ).rows[0];
      if (terminal && Number(terminal.payload.state) !== 1) continue;
      const left = new Date(r.funding_deadline).getTime() - now.getTime();
      const kind =
        left <= 3600000
          ? "funding-1h"
          : left <= 86400000
            ? "funding-24h"
            : null;
      if (!kind) continue;
      for (const m of (
        await tx.query("SELECT * FROM room_members WHERE room_id=$1", [r.id])
      ).rows) {
        const ev = (
          await tx.query(
            "SELECT kind FROM chain_events WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 AND kind IN ('Contributed','Withdrawn') AND payload->>'member'=$4 ORDER BY block_number::numeric DESC,log_index DESC LIMIT 1",
            [quote.chain_id, quote.escrow, quote.quote_id, m.account_address],
          )
        ).rows[0];
        if (ev?.kind === "Contributed") continue;
        await enqueue(tx, m.user_id, r.id, kind, r.revision);
      }
    }
  });
}
export async function deliverInApp(db: Database, now = new Date(), limit = 50) {
  return db.transaction(async (tx) => {
    const rows = (
      await tx.query(
        `SELECT o.* FROM outbox o WHERE channel='in-app' AND (status='pending' OR (status='processing' AND leased_until<$1)) AND available_at<=$1 ORDER BY available_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now, limit],
      )
    ).rows;
    let delivered = 0;
    for (const o of rows) {
      const p = (
        await tx.query(
          "SELECT * FROM notification_preferences WHERE user_id=$1",
          [o.user_id],
        )
      ).rows[0] ?? {
        in_app: true,
        timezone: "UTC",
        quiet_start: 22,
        quiet_end: 8,
      };
      if (!p.in_app) {
        await tx.query("UPDATE outbox SET status='cancelled' WHERE id=$1", [
          o.id,
        ]);
        continue;
      }
      if (o.kind.startsWith("funding")) {
        const r = (
          await tx.query("SELECT * FROM rooms WHERE id=$1", [o.room_id])
        ).rows[0];
        const funded = (
          await tx.query(
            `SELECT e.kind FROM chain_events e JOIN quote_bindings q ON e.chain_id=q.chain_id AND e.escrow=q.escrow AND e.quote_id=q.quote_id JOIN room_members m ON m.room_id=q.room_id AND m.account_address=e.payload->>'member' WHERE q.room_id=$1 AND m.user_id=$2 AND e.kind IN ('Contributed','Withdrawn') ORDER BY e.block_number::numeric DESC,e.log_index DESC LIMIT 1`,
            [o.room_id, o.user_id],
          )
        ).rows[0]?.kind === 'Contributed';
        const closed = (
          await tx.query(
            `SELECT 1 FROM chain_events e JOIN quote_bindings q ON e.chain_id=q.chain_id AND e.escrow=q.escrow AND e.quote_id=q.quote_id WHERE q.room_id=$1 AND e.kind='StateChanged' AND (e.payload->>'state')::int>=2`,
            [o.room_id],
          )
        ).rows.length;
        if (
          !r ||
          r.status !== "published" ||
          r.revision !== o.revision ||
          new Date(r.funding_deadline) <= now ||
          funded ||
          closed
        ) {
          await tx.query("UPDATE outbox SET status='cancelled' WHERE id=$1", [
            o.id,
          ]);
          continue;
        }
      }
      if (quietNow(p.timezone, p.quiet_start, p.quiet_end, now)) {
        await tx.query("UPDATE outbox SET available_at=$2 WHERE id=$1", [
          o.id,
          new Date(now.getTime() + 3600000),
        ]);
        continue;
      }
      // In-app delivery and mark committed atomically. External email transport intentionally absent.
      await tx.query(
        "UPDATE outbox SET status='delivered',attempts=attempts+1,delivered_at=$2,leased_until=NULL WHERE id=$1",
        [o.id, now],
      );
      delivered++;
    }
    return delivered;
  });
}
