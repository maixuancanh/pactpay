import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { embedded, type Database } from "../db/database.js";
import { migrate } from "../db/migrate.js";
import { persistPrivyProfile } from "../auth/privy.js";
import { Rooms } from "../rooms/service.js";
import { Support } from "../support/service.js";
import { SponsorBudget } from "../sponsorship/budget.js";
import {
  validateSponsorship,
  type SponsorPolicy,
} from "../sponsorship/policy.js";
import { ingestEvent, type ChainEvent } from "../indexer/worker.js";
import { EmbedSessions } from "../embed/sessions.js";
import {
  SponsoredSubmission,
  type SponsorTransport,
} from "../sponsorship/submit.js";
import { validateExecutionConfig, forAccount } from "../payments/config.js";
import { persistAttempt } from "../payments/attempts.js";
import { verifyRefundTransfer } from "../support/verify-transfer.js";
import { upsertIdentity } from "../auth/session.js";
import { id } from "../lib.js";
let db: Database;
before(async () => {
  db = embedded();
  await migrate(db);
});
after(async () => {
  await db.close();
});
const account = "0x" + "1".repeat(40),
  escrow = "0x" + "2".repeat(40),
  quoteId = "0x" + "3".repeat(64),
  blockHash = "0x" + "4".repeat(64),
  chainId = 31337;
const future = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
const profile = (
  subject = "did:privy:alice",
  walletId = "stable-id",
  address = account,
) => ({
  id: subject,
  linked_accounts: [
    { type: "google_oauth", subject: "google-sub", name: "Alice" },
    {
      type: "wallet",
      wallet_client_type: "privy",
      chain_type: "ethereum",
      id: walletId,
      address,
      user_can_sign: true,
    },
  ],
});
test("verified provider subject recovers stable wallet on two devices; rejects replacement and ambiguous wallets", async () => {
  const [a, b] = await Promise.all([
    persistPrivyProfile(db, "app", chainId, profile()),
    persistPrivyProfile(db, "app", chainId, profile()),
  ]);
  assert.equal(a.binding.walletId, b.binding.walletId);
  assert.equal(a.user.id, b.user.id);
  await assert.rejects(
    persistPrivyProfile(
      db,
      "app",
      chainId,
      profile(undefined, "replacement", "0x" + "5".repeat(40)),
    ),
  );
  const ambiguous = profile("did:privy:other");
  ambiguous.linked_accounts.push(ambiguous.linked_accounts[1]);
  await assert.rejects(persistPrivyProfile(db, "app", chainId, ambiguous));
});
test("support validates finalized eligible contributions; unknown transfer never counts as refunded; event retry dedup", async () => {
  const a = await persistPrivyProfile(db, "app", chainId, profile()),
    merchant = await upsertIdentity(db, {
      issuer: "test",
      subject: "merchant",
      displayName: "Merchant",
    });
  await db.query(
    "INSERT INTO wallet_bindings(id,user_id,provider,wallet_id,owner_address,account_address,chain_id,mode) VALUES($1,$2,'test',$3,$3,$3,$4,'embedded-eoa')",
    [id(), merchant.id, escrow, chainId],
  );
  const rooms = new Rooms(db, chainId);
  let r = await rooms.create(merchant.id, {
    title: "Service",
    publicTerms: "Terms",
    total: "100",
    fundingDeadline: future(24),
    serviceAt: future(48),
  });
  const invite = await rooms.invite(merchant.id, r.id, {
    expiresAt: future(1),
  });
  r = await rooms.join(a.user.id, invite.token, {
    nickname: "Alice",
    share: "100",
  });
  r = await rooms.accept(a.user.id, r.id, r.revision);
  r = await rooms.lock(merchant.id, r.id, r.revision);
  const intent = await rooms.publish(merchant.id, r.id, {
    revision: r.revision,
    idempotencyKey: id(),
    chainId,
    escrow,
    quoteId,
  });
  const event = (
    kind: string,
    payload: Record<string, any>,
    logIndex: number,
  ): ChainEvent => ({
    chainId,
    escrow,
    quoteId,
    txHash: "0x" + "a".repeat(64),
    logIndex,
    blockNumber: "10",
    blockHash,
    kind,
    payload,
    source: "test-fixture-finalized",
    coverage: { finality: "finalized" },
  });
  await db.transaction(async (tx) => {
    await ingestEvent(
      tx,
      event(
        "QuoteCreated",
        {
          termsHash: r.termsHash,
          total: "100",
          merchant: escrow,
          verifiedToken: account,
          fundingDeadline: String(
            Math.floor(Date.parse(r.fundingDeadline) / 1000),
          ),
        },
        0,
      ),
    );
    await ingestEvent(
      tx,
      event("Contributed", { member: account, amount: "100" }, 1),
    );
    await ingestEvent(
      tx,
      event("Contributed", { member: account, amount: "100" }, 1),
    );
    await ingestEvent(tx, event("StateChanged", { state: 3 }, 2));
  });
  assert.equal(
    (
      await db.query("SELECT * FROM chain_events WHERE kind=$1", [
        "Contributed",
      ])
    ).rows.length,
    1,
  );
  assert.equal((await rooms.get(a.user.id, r.id)).status, "published");
  const support = new Support(db),
    key = id(),
    request = await support.create(a.user.id, r.id, {
      amount: "60",
      reason: "Service issue",
      idempotencyKey: key,
    });
  assert.equal(
    (
      await support.create(a.user.id, r.id, {
        amount: "60",
        reason: "Service issue",
        idempotencyKey: key,
      })
    ).id,
    request.id,
  );
  await assert.rejects(
    support.create(a.user.id, r.id, {
      amount: "41",
      reason: "Duplicate",
      idempotencyKey: id(),
    }),
  );
  await assert.rejects(support.decision(a.user.id, request.id, "accepted"));
  await support.decision(merchant.id, request.id, "accepted");
  const pending = await support.transfer(
    merchant.id,
    request.id,
    "0x" + "b".repeat(64),
  );
  assert.equal(pending.status, "transfer-pending");
  assert.equal(pending.verified_amount, "0");
  await assert.rejects(
    support.transfer(merchant.id, request.id, "0x" + "c".repeat(64)),
  );
  const embeds = new EmbedSessions(db, ["https://merchant.example"]);
  await assert.rejects(
    embeds.create(merchant.id, {
      roomId: r.id,
      merchantOrigin: "https://evil.example",
    }),
  );
  const session = await embeds.create(merchant.id, {
    roomId: r.id,
    merchantOrigin: "https://merchant.example",
  });
  assert.equal((await embeds.get(session.id)).quoteId, quoteId);
  await assert.rejects(
    embeds.create(a.user.id, {
      roomId: r.id,
      merchantOrigin: "https://merchant.example",
    }),
  );
  const attemptId = id(),
    attempt = {
      kind: "payment",
      attemptId,
      submissionUncertain: true,
      finalized: true,
      binding: {
        chainId,
        account,
        escrow,
        quoteId,
        revision: r.revision,
        termsHash: r.termsHash,
      },
    };
  const stored = await persistAttempt(db, a.user.id, r.id, attempt);
  assert.equal(stored.state.finalized, false);
  await assert.rejects(
    persistAttempt(db, a.user.id, r.id, { ...attempt, attemptId: id() }),
  );
  await assert.rejects(
    persistAttempt(db, a.user.id, r.id, {
      ...attempt,
      binding: { ...attempt.binding, account: escrow },
    }),
  );
  const transferProof = {
    chainId,
    token: account,
    from: escrow,
    to: account,
    amount: "60",
    txHash: "0x" + "b".repeat(64),
    blockHash,
    blockNumber: "20",
  };
  await assert.rejects(
    verifyRefundTransfer(db, request.id, async () => ({
      ...transferProof,
      amount: "59",
    })),
  );
  await verifyRefundTransfer(db, request.id, async () => transferProof);
  assert.equal(
    (
      await db.query(
        "SELECT verified_amount FROM support_requests WHERE id=$1",
        [request.id],
      )
    ).rows[0].verified_amount,
    "60",
  );
  await assert.rejects(
    verifyRefundTransfer(db, request.id, async () => transferProof),
  );
});
test("sponsor cap concurrency, exact authorization replay protection and unknown reservation preservation", async () => {
  const user = await persistPrivyProfile(db, "app", chainId, profile()),
    rooms = new Rooms(db, chainId),
    r = await rooms.create(user.user.id, {
      title: "Budget room",
      publicTerms: "Terms",
      total: "100",
      fundingDeadline: future(24),
      serviceAt: future(48),
    }),
    budgetId = id();
  await db.query(
    "INSERT INTO sponsorship_budgets(id,merchant_id,cap,enabled) VALUES($1,$2,$3,true)",
    [budgetId, user.user.id, "10"],
  );
  const policy: SponsorPolicy = {
      chainId,
      contracts: { [escrow]: ["claim"] },
      maxPerAction: "10",
      maxPerAccountDay: "10",
      maxPerRoomDay: "10",
      enabled: true,
    },
    budget = new SponsorBudget(db, policy),
    auth = {
      chainId,
      account,
      roomId: r.id,
      contract: escrow,
      function: "claim",
      amount: "7",
      recipient: account,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      nonce: id(),
    };
  const key = id(),
    results = await Promise.allSettled([
      budget.reserve(user.user.id, budgetId, key, auth),
      budget.reserve(user.user.id, budgetId, id(), { ...auth, nonce: id() }),
    ]);
  assert.equal(results.filter((v) => v.status === "fulfilled").length, 1);
  const reservation = (
    results.find((v) => v.status === "fulfilled") as PromiseFulfilledResult<any>
  ).value;
  await budget.transition(reservation.id, "unknown");
  await assert.rejects(budget.transition(reservation.id, "released"));
  assert.equal(
    (
      await db.query("SELECT reserved FROM sponsorship_budgets WHERE id=$1", [
        budgetId,
      ])
    ).rows[0].reserved,
    "7",
  );
  assert.throws(() => validateSponsorship({ ...auth, chainId: 1 }, policy));
  assert.throws(() =>
    validateSponsorship({ ...auth, function: "transfer" }, policy),
  );
  assert.throws(() => validateSponsorship({ ...auth, amount: "11" }, policy));
});
test("sponsor transport orchestration never resubmits unknown and settles actual fee/storage once", async () => {
  const user = await persistPrivyProfile(db, "app", chainId, profile()),
    r = await new Rooms(db, chainId).create(user.user.id, {
      title: "Transport",
      publicTerms: "Terms",
      total: "1",
      fundingDeadline: future(24),
      serviceAt: future(48),
    }),
    budgetId = id();
  await db.query(
    "INSERT INTO sponsorship_budgets(id,merchant_id,cap,enabled) VALUES($1,$2,$3,true)",
    [budgetId, user.user.id, "20"],
  );
  const budget = new SponsorBudget(db, {
      chainId,
      contracts: { [escrow]: ["claim"] },
      maxPerAction: "10",
      maxPerAccountDay: "20",
      maxPerRoomDay: "20",
      enabled: true,
    }),
    auth = {
      chainId,
      account,
      roomId: r.id,
      contract: escrow,
      function: "claim",
      amount: "10",
      recipient: account,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      nonce: id(),
    };
  let sends = 0,
    finalized = false;
  const transport: SponsorTransport = {
    id: "TEST-ONLY",
    verifiedPrimitive: "paymaster",
    evidence: "Local injected fixture, not V3 proof",
    async submit(a) {
      sends++;
      assert(Object.isFrozen(a));
      throw Error("network ambiguous");
    },
    async reconcile() {
      return finalized
        ? {
            status: "finalized",
            txHash: "0x" + "f".repeat(64),
            actualExecution: "3",
            actualStorage: "2",
          }
        : { status: "pending" };
    },
  };
  const service = new SponsoredSubmission(db, budget, transport),
    key = id();
  const first = await service.submit(user.user.id, budgetId, key, auth);
  assert.equal(first.status, "unknown");
  await service.submit(user.user.id, budgetId, key, auth);
  assert.equal(sends, 1);
  assert.equal(
    (
      await db.query("SELECT reserved FROM sponsorship_budgets WHERE id=$1", [
        budgetId,
      ])
    ).rows[0].reserved,
    "10",
  );
  finalized = true;
  await service.reconcile(first.reservationId);
  await service.reconcile(first.reservationId);
  const b = (
    await db.query("SELECT * FROM sponsorship_budgets WHERE id=$1", [budgetId])
  ).rows[0];
  assert.equal(b.spent, "5");
  assert.equal(b.reserved, "0");
  await assert.rejects(
    new SponsoredSubmission(db, budget).submit(user.user.id, budgetId, id(), {
      ...auth,
      nonce: id(),
    }),
  );
});
test("public execution config binds exact account and finite denomination caps, no wildcard capability or credential URL", () => {
  const raw = {
    rpcUrl: "https://rpc.example",
    token: account,
    escrow,
    maxExecutionFee: "100",
    maxStorageDeposit: "0",
    maxWalletCreationFee: "0",
    estimateTtlMs: 60000,
    rpcDecimals: 18,
    nativeDecimals: 18,
    denominationEvidence: "Verified local fixture only",
    accountCapabilities: {
      [account]: {
        verified: true,
        chainId,
        account,
        evidence: "Local receipt fixture",
      },
    },
  };
  const c = validateExecutionConfig(raw, chainId);
  assert.equal(forAccount(c, account)?.capability.account, account);
  assert.equal(forAccount(c, escrow), null);
  const v3 = validateExecutionConfig({...raw,nativeDecimals:14,accountCapabilities:{
    [account]:{verified:true,chainId:420420777,account,evidence:'V3 finalized receipt fixture'},
  }},420420777);
  assert.equal(v3.nativeDecimals,14);

  assert.throws(() =>
    validateExecutionConfig(
      { ...raw, rpcUrl: "https://secret@rpc.example" },
      chainId,
    ),
  );
  assert.throws(() =>
    validateExecutionConfig({ ...raw, nativeDecimals: 12 }, chainId),
  );
  assert.throws(() =>
    validateExecutionConfig({ ...raw, maxExecutionFee: "Infinity" }, chainId),
  );
});
