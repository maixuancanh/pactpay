import { test } from "node:test";
import assert from "node:assert/strict";
import { postgres } from "../db/database.js";
import { migrate } from "../db/migrate.js";
import { upsertIdentity } from "../auth/session.js";
import { Rooms } from "../rooms/service.js";
import { Inventory } from "../bookings/inventory.js";
import { requireThat, id } from "../lib.js";
test("real PostgreSQL concurrent connections enforce final inventory seat and idempotent migration", async () => {
  requireThat(
    process.env.TEST_DATABASE_URL,
    "test_database_url_required",
    "Set a dedicated TEST_DATABASE_URL; this test does not silently skip",
  );
  const url = process.env.TEST_DATABASE_URL,
    admin = postgres(url),
    schema = "pactpay_test_" + id().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = postgres(url, schema);
  try {
    await migrate(db);
    await migrate(db);
    const u = await upsertIdentity(db, {
        issuer: "test",
        subject: "inventory-merchant",
        displayName: "Merchant",
      }),
      rooms = new Rooms(db, 1),
      inventory = new Inventory(db),
      serviceAt = new Date(Date.now() + 172800000).toISOString(),
      input = {
        title: "Real SQL",
        publicTerms: "Terms",
        total: "100",
        fundingDeadline: new Date(Date.now() + 86400000).toISOString(),
        serviceAt,
      };
    const [a, b] = await Promise.all([
        rooms.create(u.id, input),
        rooms.create(u.id, input),
      ]),
      slot = await inventory.create(u.id, {
        label: "Seat",
        capacity: 1,
        serviceAt,
      });
    const results = await Promise.allSettled([
      inventory.reserve(u.id, a.id, {
        slotId: slot.id,
        quantity: 1,
        ttlSeconds: 60,
      }),
      inventory.reserve(u.id, b.id, {
        slotId: slot.id,
        quantity: 1,
        ttlSeconds: 60,
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT SUM(quantity) AS used FROM inventory_holds WHERE status<>'released'",
        )
      ).rows[0].used,
      "1",
    );
  } finally {
    await db.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
});
