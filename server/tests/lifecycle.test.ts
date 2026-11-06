import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { embedded } from "../db/database.js";
import { migrate } from "../db/migrate.js";
import { upsertIdentity } from "../auth/session.js";
import { Rooms } from "../rooms/service.js";
import { deletePrivateProfile } from "../auth/privacy.js";
import { extractInvoice } from "../invoice/extract.js";
import { deliverEmail } from "../notifications/email.js";
import {
  deliverWebhooks,
  signWebhook,
  validateDestinations,
} from "../embed/webhooks.js";
import { id } from "../lib.js";
test("embedded backup restores migrations, private rooms and pending unknown intents without mutating original", async () => {
  const original = embedded();
  try {
    await migrate(original);
    const u = await upsertIdentity(original, {
        issuer: "test",
        subject: "backup-owner",
        displayName: "Owner",
      }),
      rooms = new Rooms(original, 31337),
      room = await rooms.create(u.id, {
        title: "Recover me",
        publicTerms: "Terms",
        total: "100",
        fundingDeadline: new Date(Date.now() + 86400000).toISOString(),
        serviceAt: new Date(Date.now() + 172800000).toISOString(),
      });
    const snapshot = await original.backup(),
      restored = embedded(undefined, snapshot);
    try {
      await migrate(restored);
      assert.equal(
        (await new Rooms(restored, 31337).get(u.id, room.id)).title,
        "Recover me",
      );
      await restored.query(
        "UPDATE rooms SET title='Restored copy' WHERE id=$1",
        [room.id],
      );
      assert.equal((await rooms.get(u.id, room.id)).title, "Recover me");
      assert.equal(
        (await restored.query("SELECT * FROM schema_migrations")).rows.length,
        (await original.query("SELECT * FROM schema_migrations")).rows.length,
      );
    } finally {
      await restored.close();
    }
  } finally {
    await original.close();
  }
});
test("profile deletion removes private display information, revokes sessions, preserves room financial link", async () => {
  const db = embedded();
  try {
    await migrate(db);
    const u = await upsertIdentity(db, {
        issuer: "test",
        subject: "delete-owner",
        displayName: "Private name",
      }),
      rooms = new Rooms(db, 1),
      room = await rooms.create(u.id, {
        title: "Public booking",
        publicTerms: "Public immutable terms",
        total: "1",
        fundingDeadline: new Date(Date.now() + 86400000).toISOString(),
        serviceAt: new Date(Date.now() + 172800000).toISOString(),
      });
    await db.query("UPDATE users SET notification_email=$2 WHERE id=$1", [
      u.id,
      "private@example.test",
    ]);
    await assert.rejects(deletePrivateProfile(db, u.id, "yes"));
    await deletePrivateProfile(db, u.id, "DELETE_PRIVATE_PROFILE");
    const user = (await db.query("SELECT * FROM users WHERE id=$1", [u.id]))
      .rows[0];
    assert.equal(user.display_name, "Deleted profile");
    assert.equal(user.notification_email, null);
    assert.equal(
      (await rooms.get(u.id, room.id)).publicTerms,
      "Public immutable terms",
    );
    assert.equal(user.subject, "delete-owner");
  } finally {
    await db.close();
  }
});
test("OCR verifies image bytes and explicit processor consent and returns reviewable extraction only", async () => {
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  let calls = 0;
  const adapter = {
    recipient: "Test fixture processor",
    cloud: true,
    extract: async () => {
      calls++;
      return {
        currency: "dUSD",
        lineItems: [{ label: "Line", amount: "1" }],
        subtotal: "1",
        tax: "0",
        service: "0",
        discount: "0",
        total: "1",
        confidence: 0.99,
      };
    },
  };
  await assert.rejects(
    extractInvoice(
      Buffer.from(image),
      "image/jpeg",
      adapter,
      "Test fixture processor",
    ),
  );
  await assert.rejects(
    extractInvoice(Buffer.from(image), "image/png", adapter),
  );
  assert.equal(calls, 0);
  const output = await extractInvoice(
    Buffer.from(image),
    "image/png",
    adapter,
    "Test fixture processor",
  );
  assert.equal(output.canAutoPublish, false);
  assert.equal(output.confirmationRequired, true);
  assert.equal(calls, 1);
});
test("email failure preserves durable job, later retry delivers once with idempotency identity", async () => {
  const db = embedded();
  try {
    await migrate(db);
    const u = await upsertIdentity(db, {
      issuer: "test",
      subject: "email",
      displayName: "Email",
    });
    await db.query("UPDATE users SET notification_email=$2 WHERE id=$1", [
      u.id,
      "verified@example.test",
    ]);
    await db.query(
      "INSERT INTO notification_preferences(user_id,email,quiet_start,quiet_end) VALUES($1,true,0,0)",
      [u.id],
    );
    const job = id();
    await db.query(
      "INSERT INTO outbox(id,user_id,kind,revision,payload,channel,dedup_key) VALUES($1,$2,'payment-open',1,'{}','email',$1)",
      [job, u.id],
    );
    let attempt = 0;
    const transport = {
      send: async (input: { idempotencyKey: string }) => {
        assert.equal(input.idempotencyKey, job);
        if (++attempt === 1) throw Error("fixture timeout");
      },
    };
    const now = new Date();
    await deliverEmail(db, transport, "https://app.example", now);
    assert.equal(
      (await db.query("SELECT status FROM outbox WHERE id=$1", [job])).rows[0]
        .status,
      "pending",
    );
    await deliverEmail(
      db,
      transport,
      "https://app.example",
      new Date(now.getTime() + 10000),
    );
    await deliverEmail(
      db,
      transport,
      "https://app.example",
      new Date(now.getTime() + 20000),
    );
    assert.equal(attempt, 2);
    assert.equal(
      (await db.query("SELECT status FROM outbox WHERE id=$1", [job])).rows[0]
        .status,
      "delivered",
    );
  } finally {
    await db.close();
  }
});
test("signed merchant webhook exact HTTPS allowlist, replay id and durable retry", async () => {
  const db = embedded();
  try {
    await migrate(db);
    const u = await upsertIdentity(db, {
        issuer: "test",
        subject: "webhook",
        displayName: "Merchant",
      }),
      dest = validateDestinations([
        {
          merchantId: u.id,
          endpoint: "https://merchant.example/hooks",
          allowedOrigin: "https://merchant.example",
          secret: "s".repeat(32),
        },
      ]);
    assert.throws(() =>
      validateDestinations([
        { ...dest[0], endpoint: "https://evil.example/hooks" },
      ]),
    );
    const job = id();
    await db.query(
      "INSERT INTO merchant_webhook_outbox(id,merchant_id,event_key,payload) VALUES($1,$2,$3,$4)",
      [
        job,
        u.id,
        "chain:tx:log",
        JSON.stringify({ kind: "Contributed", finality: "finalized" }),
      ],
    );
    let calls = 0;
    const send = (async (url: string | URL | Request, options: RequestInit) => {
      assert.equal(url, dest[0].endpoint);
      const headers = options.headers as Record<string, string>,
        body = options.body as string;
      assert.equal(
        headers["X-PactPay-Signature"],
        signWebhook(dest[0].secret, headers["X-PactPay-Timestamp"], body),
      );
      assert.equal(headers["Idempotency-Key"], "chain:tx:log");
      assert.equal(JSON.parse(body).deliveryId, job);
      calls++;
      return new Response(null, { status: calls === 1 ? 503 : 200 });
    }) as typeof fetch;
    const now = new Date();
    await deliverWebhooks(db, dest, send, now);
    await deliverWebhooks(db, dest, send, new Date(now.getTime() + 10000));
    await deliverWebhooks(db, dest, send, new Date(now.getTime() + 20000));
    assert.equal(calls, 2);
    assert.equal(
      (
        await db.query(
          "SELECT status FROM merchant_webhook_outbox WHERE id=$1",
          [job],
        )
      ).rows[0].status,
      "delivered",
    );
  } finally {
    await db.close();
  }
});
