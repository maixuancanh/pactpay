import type { Database } from "../db/database.js";
import { requireThat } from "../lib.js";
import { quietNow } from "./policy.js";
export type EmailTransport = {
  send: (input: {
    to: string;
    kind: string;
    url: string;
    idempotencyKey: string;
  }) => Promise<void>;
};
/** Processor must honor Idempotency-Key; retries are at-least-once across network timeouts. */
export function httpEmail(
  endpoint: string,
  allowedOrigin: string,
  bearerToken: string,
): EmailTransport {
  const url = new URL(endpoint);
  requireThat(
    url.protocol === "https:" && url.origin === allowedOrigin,
    "email_endpoint_not_allowed",
  );
  return {
    async send(input) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      requireThat(response.ok, "email_delivery_failed", undefined, 502);
    },
  };
}
export async function scheduleEmail(db: Database) {
  await db.query(
    `INSERT INTO outbox(id,user_id,room_id,kind,revision,payload,channel,dedup_key) SELECT o.id||':email',o.user_id,o.room_id,o.kind,o.revision,o.payload,'email',o.dedup_key||':email' FROM outbox o JOIN notification_preferences p ON p.user_id=o.user_id JOIN users u ON u.id=o.user_id WHERE o.channel='in-app' AND o.status IN ('pending','delivered') AND p.email=true AND u.notification_email IS NOT NULL ON CONFLICT(dedup_key) DO NOTHING`,
  );
}
export async function deliverEmail(
  db: Database,
  transport: EmailTransport,
  appOrigin: string,
  now = new Date(),
) {
  const jobs = await db.transaction(async (tx) => {
    const rows = (
      await tx.query(
        `SELECT o.*,u.notification_email FROM outbox o JOIN users u ON u.id=o.user_id JOIN notification_preferences p ON p.user_id=o.user_id WHERE o.channel='email' AND p.email=true AND (o.status='pending' OR (o.status='processing' AND o.leased_until<$1)) AND o.available_at<=$1 ORDER BY available_at LIMIT 20 FOR UPDATE OF o SKIP LOCKED`,
        [now],
      )
    ).rows;
    const selected = [];
    for (const job of rows) {
      const pref = (
        await tx.query(
          "SELECT * FROM notification_preferences WHERE user_id=$1",
          [job.user_id],
        )
      ).rows[0];
      if (quietNow(pref.timezone, pref.quiet_start, pref.quiet_end, now))
        continue;
      if (job.kind.startsWith("funding")) {
        const valid = (
          await tx.query(
            "SELECT 1 FROM rooms WHERE id=$1 AND status='published' AND revision=$2 AND funding_deadline>$3",
            [job.room_id, job.revision, now],
          )
        ).rows.length;
        const funded = (
          await tx.query(
            `SELECT e.kind FROM chain_events e JOIN quote_bindings q ON e.chain_id=q.chain_id AND e.escrow=q.escrow AND e.quote_id=q.quote_id JOIN room_members m ON m.room_id=q.room_id AND m.account_address=e.payload->>'member' WHERE q.room_id=$1 AND m.user_id=$2 AND e.kind IN ('Contributed','Withdrawn') ORDER BY e.block_number::numeric DESC,e.log_index DESC LIMIT 1`,
            [job.room_id, job.user_id],
          )
        ).rows[0]?.kind === 'Contributed';
        const stale = (
          await tx.query(
            `SELECT 1 FROM chain_events e JOIN quote_bindings q ON e.chain_id=q.chain_id AND e.escrow=q.escrow AND e.quote_id=q.quote_id WHERE q.room_id=$1 AND e.kind='StateChanged' AND (e.payload->>'state')::int>=2`,
            [job.room_id],
          )
        ).rows.length;
        if (!valid || stale || funded) {
          await tx.query("UPDATE outbox SET status='cancelled' WHERE id=$1", [
            job.id,
          ]);
          continue;
        }
      }
      await tx.query(
        "UPDATE outbox SET status='processing',leased_until=$2,attempts=attempts+1 WHERE id=$1",
        [job.id, new Date(now.getTime() + 60000)],
      );
      selected.push(job);
    }
    return selected;
  });
  for (const job of jobs) {
    try {
      await transport.send({
        to: job.notification_email,
        kind: job.kind,
        url: `${appOrigin}/booking?room=${encodeURIComponent(job.room_id)}`,
        idempotencyKey: job.dedup_key,
      });
      await db.query(
        "UPDATE outbox SET status='delivered',delivered_at=now(),leased_until=NULL WHERE id=$1",
        [job.id],
      );
    } catch {
      await db.query(
        "UPDATE outbox SET status='pending',available_at=$2,last_error='transport_failed',leased_until=NULL WHERE id=$1",
        [
          job.id,
          new Date(
            now.getTime() +
              Math.min(3600000, 1000 * 2 ** Math.min(job.attempts + 1, 12)),
          ),
        ],
      );
    }
  }
  return jobs.length;
}
