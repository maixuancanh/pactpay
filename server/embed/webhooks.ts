import { createHmac } from "node:crypto";
import type { Database } from "../db/database.js";
import { canonical, requireThat } from "../lib.js";
export type WebhookDestination = {
  merchantId: string;
  endpoint: string;
  allowedOrigin: string;
  secret: string;
};
export function validateDestinations(raw: unknown): WebhookDestination[] {
  requireThat(Array.isArray(raw), "invalid_webhook_config");
  return raw.map((d) => {
    requireThat(
      d &&
        typeof d.merchantId === "string" &&
        typeof d.endpoint === "string" &&
        typeof d.allowedOrigin === "string" &&
        typeof d.secret === "string" &&
        d.secret.length >= 32,
      "invalid_webhook_destination",
    );
    const url = new URL(d.endpoint);
    requireThat(
      url.protocol === "https:" &&
        url.origin === d.allowedOrigin &&
        !url.username &&
        !url.password,
      "webhook_destination_not_allowed",
    );
    return d as WebhookDestination;
  });
}
export function signWebhook(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}
export async function deliverWebhooks(
  db: Database,
  destinations: WebhookDestination[],
  send: typeof fetch = fetch,
  now = new Date(),
) {
  if (!destinations.length) return 0;
  const jobs = await db.transaction(async (tx) => {
    const rows = (
      await tx.query(
        `SELECT * FROM merchant_webhook_outbox WHERE (status='pending' OR (status='processing' AND leased_until<$1)) AND available_at<=$1 ORDER BY available_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
        [now],
      )
    ).rows;
    const result = [];
    for (const job of rows) {
      const destination = destinations.find(
        (d) => d.merchantId === job.merchant_id,
      );
      if (!destination) continue;
      await tx.query(
        "UPDATE merchant_webhook_outbox SET status='processing',leased_until=$2,attempts=attempts+1 WHERE id=$1",
        [job.id, new Date(now.getTime() + 60000)],
      );
      result.push({ job, destination });
    }
    return result;
  });
  for (const { job, destination } of jobs) {
    const timestamp = Math.floor(now.getTime() / 1000).toString(),
      body = canonical({ deliveryId: job.id, ...job.payload });
    try {
      const response = await send(destination.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PactPay-Timestamp": timestamp,
          "X-PactPay-Signature": signWebhook(
            destination.secret,
            timestamp,
            body,
          ),
          "Idempotency-Key": job.event_key,
        },
        body,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      requireThat(response.ok, "webhook_delivery_failed");
      await db.query(
        "UPDATE merchant_webhook_outbox SET status='delivered',leased_until=NULL,delivered_at=$2 WHERE id=$1",
        [job.id, now],
      );
    } catch {
      await db.query(
        "UPDATE merchant_webhook_outbox SET status='pending',leased_until=NULL,available_at=$2 WHERE id=$1",
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
