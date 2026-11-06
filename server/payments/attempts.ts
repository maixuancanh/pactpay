import type { Database, Row } from "../db/database.js";
import { address, hex32, id, requireThat } from "../lib.js";
import { authorizedRoom } from "../rooms/service.js";
export async function persistAttempt(
  db: Database,
  userId: string,
  roomId: string,
  raw: Row,
) {
  return db.transaction(async (tx) => {
    const room = await authorizedRoom(tx, roomId, userId, false, true);
    if (["publish", "merchant-payout", "cancel"].includes(raw.kind))
      requireThat(
        room.merchant_id === userId,
        "merchant_required",
        undefined,
        403,
      );
    if (["approval", "payment", "refund"].includes(raw.kind))
      requireThat(
        (
          await tx.query(
            "SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2",
            [roomId, userId],
          )
        ).rows.length,
        "member_required",
        undefined,
        403,
      );
    const b = raw.binding;
    requireThat(b && typeof b === "object", "attempt_binding_required");
    const account = address(b.account),
      escrow = address(b.escrow),
      quoteId = hex32(b.quoteId);
    requireThat(
      [
        "approval",
        "payment",
        "publish",
        "merchant-payout",
        "cancel",
        "refund",
      ].includes(raw.kind),
      "invalid_attempt_action",
    );
    const wallet = (
      await tx.query(
        "SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2",
        [userId, b.chainId],
      )
    ).rows[0];
    requireThat(
      wallet && (account === (room.merchant_id===userId?room.merchant_account_address??wallet.account_address:(await tx.query('SELECT account_address FROM room_members WHERE room_id=$1 AND user_id=$2',[roomId,userId])).rows[0]?.account_address)),
      "attempt_account_forbidden",
      undefined,
      403,
    );
    const q = (
      await tx.query("SELECT * FROM quote_bindings WHERE room_id=$1", [roomId])
    ).rows[0];
    requireThat(
      q &&
        Number(q.chain_id) === b.chainId &&
        q.escrow === escrow &&
        q.quote_id === quoteId &&
        q.terms_hash === b.termsHash &&
        q.revision === b.revision,
      "attempt_quote_mismatch",
      undefined,
      409,
    );
    requireThat(
      typeof raw.attemptId === "string" && raw.attemptId.length <= 100,
      "attempt_id_required",
    );
    const old = (
      await tx.query(
        "SELECT * FROM payment_attempts WHERE user_id=$1 AND room_id=$2 AND action=$3 FOR UPDATE",
        [userId, roomId, raw.kind],
      )
    ).rows[0];
    const txHash = raw.transactionHash ? hex32(raw.transactionHash) : null;
    const retryAfterProvenFailure=old?.status==='failed'&&old.state.attemptId!==raw.attemptId;
    requireThat(
      !old || retryAfterProvenFailure || old.state.attemptId === raw.attemptId,
      "another_device_attempt_requires_reconciliation",
      undefined,
      409,
    );
    requireThat(
      retryAfterProvenFailure || !old?.tx_hash || old.tx_hash === txHash,
      "unknown_attempt_reconcile_first",
      undefined,
      409,
    );
    // No signed payload, secret, arbitrary nested data or browser finality claims are stored.
    const state = {
      attemptId: raw.attemptId,
      kind: raw.kind,
      binding: {
        account,
        chainId: b.chainId,
        escrow,
        quoteId,
        revision: b.revision,
        termsHash: b.termsHash,
      },
      transactionHash: txHash,
      finalized: false,
      submissionUncertain: !!raw.submissionUncertain,
    };
    const status = txHash || raw.submissionUncertain ? "unknown" : "prepared";
    return (
      await tx.query(
        `INSERT INTO payment_attempts(id,user_id,room_id,chain_id,account_address,escrow,quote_id,action,tx_hash,status,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(user_id,room_id,action) DO UPDATE SET tx_hash=EXCLUDED.tx_hash,status=CASE WHEN payment_attempts.status='finalized' THEN 'finalized' ELSE EXCLUDED.status END,state=EXCLUDED.state,updated_at=now() RETURNING *`,
        [
          old?.id ?? id(),
          userId,
          roomId,
          b.chainId,
          account,
          escrow,
          quoteId,
          raw.kind,
          txHash,
          status,
          JSON.stringify(state),
        ],
      )
    ).rows[0];
  });
}
