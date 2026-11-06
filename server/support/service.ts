import type { Database, Row } from "../db/database.js";
import { hex32, id, positive, requireThat, text } from "../lib.js";
import { authorizedRoom } from "../rooms/service.js";
export class Support {
  constructor(private db: Database) {}
  async list(userId: string, roomId: string) {
    const r = await authorizedRoom(this.db, roomId, userId);
    return (
      await this.db.query(
        "SELECT * FROM support_requests WHERE room_id=$1 AND ($2= $3 OR user_id=$2) ORDER BY created_at DESC",
        [roomId, userId, r.merchant_id],
      )
    ).rows;
  }
  async create(userId: string, roomId: string, p: Row) {
    return this.db.transaction(async (tx) => {
      await authorizedRoom(tx, roomId, userId, false, true);
      const m = (
        await tx.query(
          "SELECT * FROM room_members WHERE room_id=$1 AND user_id=$2",
          [roomId, userId],
        )
      ).rows[0];
      requireThat(m, "member_required", undefined, 403);
      const requested = positive(p.amount),
        key = text(p.idempotencyKey, 100);
      const old = (
        await tx.query(
          "SELECT * FROM support_requests WHERE idempotency_key=$1",
          [key],
        )
      ).rows[0];
      if (old) {
        requireThat(
          old.user_id === userId &&
            old.room_id === roomId &&
            old.amount === requested,
          "idempotency_conflict",
          undefined,
          409,
        );
        return old;
      }
      const quote = (
        await tx.query("SELECT * FROM quote_bindings WHERE room_id=$1", [
          roomId,
        ])
      ).rows[0];
      requireThat(quote, "finalized_quote_required", undefined, 409);
      const captured = (
        await tx.query(
          "SELECT 1 FROM chain_events WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 AND kind='StateChanged' AND payload->>'state'='3'",
          [quote.chain_id, quote.escrow, quote.quote_id],
        )
      ).rows.length;
      requireThat(captured, "captured_payment_required", undefined, 409);
      const events = (
        await tx.query(
          "SELECT kind,payload FROM chain_events WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 AND kind IN ('Contributed','Withdrawn') AND payload->>'member'=$4 ORDER BY block_number::numeric,log_index",
          [quote.chain_id, quote.escrow, quote.quote_id, m.account_address],
        )
      ).rows;
      let paid = 0n;
      for (const e of events)
        paid +=
          e.kind === "Contributed"
            ? BigInt(e.payload.amount)
            : -BigInt(e.payload.amount);
      const open = (
        await tx.query(
          "SELECT amount FROM support_requests WHERE room_id=$1 AND user_id=$2 AND status<>'rejected'",
          [roomId, userId],
        )
      ).rows.reduce((n, r) => n + BigInt(r.amount), 0n);
      requireThat(
        open + BigInt(requested) <= paid,
        "refund_exceeds_eligible_paid",
      );
      const request = (
        await tx.query(
          "INSERT INTO support_requests(id,room_id,user_id,amount,reason,idempotency_key,nonce) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [id(), roomId, userId, requested, text(p.reason, 2000), key, id()],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO support_audit(id,request_id,actor_id,kind) VALUES($1,$2,$3,$4)",
        [id(), request.id, userId, "opened"],
      );
      return request;
    });
  }
  async decision(userId: string, requestId: string, decision: string) {
    requireThat(
      ["accepted", "rejected"].includes(decision),
      "invalid_decision",
    );
    return this.db.transaction(async (tx) => {
      const r = (
        await tx.query(
          "SELECT * FROM support_requests WHERE id=$1 FOR UPDATE",
          [requestId],
        )
      ).rows[0];
      requireThat(r, "request_not_found", undefined, 404);
      await authorizedRoom(tx, r.room_id, userId, true);
      requireThat(r.status === "open", "request_not_open", undefined, 409);
      const result = (
        await tx.query(
          "UPDATE support_requests SET status=$2 WHERE id=$1 RETURNING *",
          [requestId, decision],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO support_audit(id,request_id,actor_id,kind) VALUES($1,$2,$3,$4)",
        [id(), requestId, userId, decision],
      );
      return result;
    });
  }
  async transfer(userId: string, requestId: string, txHash: unknown) {
    return this.db.transaction(async (tx) => {
      const r = (
        await tx.query(
          "SELECT * FROM support_requests WHERE id=$1 FOR UPDATE",
          [requestId],
        )
      ).rows[0];
      requireThat(r, "request_not_found", undefined, 404);
      await authorizedRoom(tx, r.room_id, userId, true);
      const h = hex32(txHash);
      requireThat(
        ["accepted", "transfer-pending"].includes(r.status),
        "request_not_accepted",
      );
      requireThat(
        !r.transfer_hash || r.transfer_hash === h,
        "unknown_transfer_reconcile_first",
        undefined,
        409,
      );
      return (
        await tx.query(
          "UPDATE support_requests SET transfer_hash=$2,status='transfer-pending' WHERE id=$1 RETURNING *",
          [requestId, h],
        )
      ).rows[0];
    });
  }
}
