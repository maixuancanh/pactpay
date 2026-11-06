import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { embedded, type Database } from "../db/database.js";
import { migrate } from "../db/migrate.js";
import { Sessions, upsertIdentity } from "../auth/session.js";
import { Rooms } from "../rooms/service.js";
import { Inventory } from "../bookings/inventory.js";
import { equalSplit, validateInvoice } from "../invoice/extract.js";
import { syncAccount } from "../sync/routes.js";
import { runIndexer, type ChainReader } from "../indexer/worker.js";
import { createApp } from "../app.js";
import { deliverInApp, enqueue } from "../notifications/worker.js";
import { Templates } from "../templates/routes.js";
import { quietNow } from "../notifications/policy.js";
import { id } from "../lib.js";
let db: Database;
let merchant: string, alice: string, bob: string, outsider: string;
const chain = 31337,
  now = Date.now(),
  future = (hours: number) => new Date(now + hours * 3600000).toISOString();
before(async () => {
  db = embedded();
  await migrate(db);
  await migrate(db);
  for (const subject of ["merchant", "alice", "bob", "outsider"]) {
    const u = await upsertIdentity(db, {
      issuer: "test-fixture",
      subject,
      displayName: subject,
    });
    if (subject === "merchant") merchant = u.id;
    if (subject === "alice") alice = u.id;
    if (subject === "bob") bob = u.id;
    if (subject === "outsider") outsider = u.id;
    await db.query(
      "INSERT INTO wallet_bindings(id,user_id,provider,wallet_id,owner_address,account_address,chain_id,mode) VALUES($1,$2,'test-fixture',$3,$3,$3,$4,'embedded-eoa')",
      [
        id(),
        u.id,
        `0x${String(["merchant", "alice", "bob", "outsider"].indexOf(subject) + 1).padStart(40, "0")}`,
        chain,
      ],
    );
  }
});
after(async () => {
  await db.close();
});
const draft = () => ({
  title: "Dinner",
  publicTerms: "Public cancellation terms",
  total: "100",
  fundingDeadline: future(24),
  serviceAt: future(48),
});
test("same verified identity retains user; equal email never merges subjects", async () => {
  const s = new Sessions(db, async (c) => ({
    issuer: "test",
    subject: c,
    displayName: "same@email.test",
  }));
  const a = await s.login("one"),
    b = await s.login("one"),
    c = await s.login("two");
  assert.equal(a.user.id, b.user.id);
  assert.notEqual(a.user.id, c.user.id);
  await s.logout(a.sessionToken);
  assert.equal(await s.get(a.sessionToken), null);
});
test("unconfigured authentication fails closed", async () => {
  await assert.rejects(new Sessions(db).login("fake"), /not configured/);
});
test("revision invalidation, unauthorized access, canonical lock and idempotent publish", async () => {
  const rooms = new Rooms(db, chain);
  let r = await rooms.create(merchant, draft());
  const inv = await rooms.invite(merchant, r.id, { expiresAt: future(12) });
  r = await rooms.join(alice, inv.token, { nickname: "Alice", share: "100" });
  await rooms.accept(alice, r.id, r.revision);
  await assert.rejects(rooms.get(outsider, r.id));
  await assert.rejects(
    rooms.join(alice, inv.token, { nickname: "again", share: "1" }),
  );
  r = await rooms.edit(merchant, r.id, {
    expectedRevision: r.revision,
    title: "Updated",
  });
  assert.equal(r.members[0].acceptedRevision, null);
  await assert.rejects(rooms.lock(merchant, r.id, r.revision));
  r = await rooms.accept(alice, r.id, r.revision);
  r = await rooms.lock(merchant, r.id, r.revision);
  assert.match(r.termsHash!, /^0x[0-9a-f]{64}$/);
  const input = {
    revision: r.revision,
    idempotencyKey: id(),
    chainId: chain,
    escrow: "0x" + "9".repeat(40),
    quoteId: "0x" + "a".repeat(64),
  };
  const [a, b] = await Promise.all([
    rooms.publish(merchant, r.id, input),
    rooms.publish(merchant, r.id, input),
  ]);
  assert.equal(a.id, b.id);
  await rooms.submitted(merchant, r.id, a.id, "0x" + "b".repeat(64));
  await assert.rejects(
    rooms.submitted(merchant, r.id, a.id, "0x" + "c".repeat(64)),
  );
  await assert.rejects(
    rooms.edit(merchant, r.id, {
      expectedRevision: r.revision,
      title: "Changed",
    }),
  );
});
test("recipient invitation cannot be joined by another verified user", async () => {
  const rooms = new Rooms(db, chain),
    r = await rooms.create(merchant, draft()),
    inv = await rooms.invite(merchant, r.id, {
      expiresAt: future(1),
      recipientUserId: alice,
    });
  await assert.rejects(
    rooms.join(bob, inv.token, { nickname: "Alice", share: "100" }),
  );
  await rooms.revoke(merchant, r.id, inv.id);
  await assert.rejects(
    rooms.join(alice, inv.token, { nickname: "Alice", share: "100" }),
  );
});
test("parallel reservations cannot oversell final seat; funding hold does not expire", async () => {
  const rooms = new Rooms(db, chain),
    inventory = new Inventory(db),
    a = await rooms.create(merchant, draft()),
    b = await rooms.create(merchant, draft()),
    slot = await inventory.create(merchant, {
      label: "Final seat",
      capacity: 1,
      serviceAt: future(48),
    });
  const results = await Promise.allSettled([
    inventory.reserve(merchant, a.id, {
      slotId: slot.id,
      quantity: 1,
      ttlSeconds: 30,
    }),
    inventory.reserve(merchant, b.id, {
      slotId: slot.id,
      quantity: 1,
      ttlSeconds: 30,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const hold = (
    results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>
  ).value;
  await db.query(
    "UPDATE inventory_holds SET status='funding',expires_at=$2 WHERE id=$1",
    [hold.id, new Date(0)],
  );
  await assert.rejects(
    inventory.reserve(merchant, hold.room_id === a.id ? b.id : a.id, {
      slotId: slot.id,
      quantity: 1,
      ttlSeconds: 30,
    }),
  );
});
test("sync exposes no other users private rooms", async () => {
  const rooms = new Rooms(db, chain),
    mine = await rooms.create(merchant, draft());
  const result = await syncAccount(db, rooms, outsider);
  assert(!result.rooms.some((r) => r.id === mine.id));
  assert.equal(result.events.length, 0);
});
test("templates create empty new drafts and enforce ownership and new time", async () => {
  const rooms = new Rooms(db, chain),
    templates = new Templates(db, rooms);
  const t = await templates.create(merchant, {
    ...draft(),
    sharePolicy: "equal",
    durationMinutes: 60,
    slotType: "table",
  });
  const r = await templates.duplicate(merchant, t.id, {
    fundingDeadline: future(24),
    serviceAt: future(48),
  });
  assert.equal(r.members.length, 0);
  assert.equal(r.status, "draft");
  await assert.rejects(
    templates.duplicate(outsider, t.id, {
      fundingDeadline: future(24),
      serviceAt: future(48),
    }),
  );
  await assert.rejects(
    templates.duplicate(merchant, t.id, {
      fundingDeadline: new Date(0).toISOString(),
      serviceAt: future(48),
    }),
  );
});
test("indexer persists finality cursor atomically, repeated page does not double count, outage preserves cursor", async () => {
  const reader: ChainReader = {
    async readFinalized(from) {
      return {
        chainId: chain,
        from: from.toString(),
        to: from.toString(),
        blockHash: "0x" + "d".repeat(64),
        coverage: { finality: "finalized" },
        events: [],
      };
    },
  };
  await runIndexer(db, "test", chain, 5n, reader);
  assert.equal(
    (
      await db.query(
        "SELECT block_number FROM indexer_cursors WHERE stream='test'",
      )
    ).rows[0].block_number,
    "5",
  );
  await assert.rejects(
    runIndexer(db, "test", chain, 5n, {
      readFinalized: async () => {
        throw Error("provider outage");
      },
    }),
  );
  assert.equal(
    (
      await db.query(
        "SELECT block_number FROM indexer_cursors WHERE stream='test'",
      )
    ).rows[0].block_number,
    "5",
  );
  const results = await Promise.all([
    runIndexer(db, "test", chain, 5n, reader),
    runIndexer(db, "test", chain, 5n, reader),
  ]);
  assert.equal(results.filter((r) => r.advanced).length, 1);
});
test("in-app delivery deduplicates transactionally and honors quiet hours", async () => {
  const rooms = new Rooms(db, chain),
    r = await rooms.create(merchant, draft());
  await db.query(
    "INSERT INTO notification_preferences(user_id,quiet_start,quiet_end) VALUES($1,0,0) ON CONFLICT(user_id) DO UPDATE SET quiet_start=0,quiet_end=0",
    [alice],
  );
  await db.transaction(async (tx) => {
    await enqueue(tx, alice, r.id, "payment-open", 1);
    await enqueue(tx, alice, r.id, "payment-open", 1);
  });
  await Promise.all([deliverInApp(db), deliverInApp(db)]);
  assert.equal(
    (
      await db.query(
        "SELECT * FROM outbox WHERE user_id=$1 AND room_id=$2 AND status='delivered'",
        [alice, r.id],
      )
    ).rows.length,
    1,
  );
  assert.equal(quietNow("UTC", 22, 8, new Date("2026-01-01T23:00:00Z")), true);
});
test("integer splitting preserves every unit, OCR totals and currency require review", () => {
  assert.deepEqual(equalSplit("1", 3).shares, ["1", "0", "0"]);
  const base = {
    currency: "dUSD",
    lineItems: [{ label: "one", amount: "10" }],
    subtotal: "10",
    tax: "1",
    service: "0",
    discount: "1",
    total: "10",
    confidence: 0.99,
  };
  assert.equal(validateInvoice(base).requiresManualReview, false);
  assert.equal(
    validateInvoice({ ...base, total: "11" }).requiresManualReview,
    true,
  );
  assert.equal(
    validateInvoice({ ...base, currency: "USD" }).requiresManualReview,
    true,
  );
  assert.throws(() => validateInvoice({ ...base, total: "1,000" }));
});
test("HTTP rejects unauthenticated private reads and forged origin/CSRF", async () => {
  const app = createApp(db, {
    origin: "http://127.0.0.1:5173",
    chainId: chain,
    secureCookies: false,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const info = app.server.address() as { port: number },
    base = `http://127.0.0.1:${info.port}`;
  try {
    assert.equal((await fetch(base + "/api/rooms")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/auth/google", {
          method: "POST",
          headers: {
            Origin: "https://evil.test",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    const s = await fetch(base + "/api/session"),
      payload = (await s.json()) as any;
    assert.equal(payload.user, null);
    assert(payload.csrfToken);
    const login = await fetch(base + "/api/auth/google", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-CSRF-Token": payload.csrfToken,
        Cookie: s.headers.get("set-cookie")!.split(";")[0],
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idToken: "fake" }),
    });
    assert.equal(login.status, 503);
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  }
});
