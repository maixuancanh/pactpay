import type { Database } from "../db/database.js";
import { canonical, id, positive, requireThat } from "../lib.js";
import {
  validateSponsorship,
  type SponsorAuthorization,
  type SponsorPolicy,
} from "./policy.js";
export class SponsorBudget {
  constructor(
    private db: Database,
    private policy: SponsorPolicy,
  ) {}
  async reserve(
    userId: string,
    budgetId: string,
    key: string,
    raw: SponsorAuthorization,
  ) {
    const a = validateSponsorship(raw, this.policy);
    return this.db.transaction(async (tx) => {
      const b = (
        await tx.query(
          "SELECT * FROM sponsorship_budgets WHERE id=$1 FOR UPDATE",
          [budgetId],
        )
      ).rows[0];
      requireThat(b?.enabled, "budget_disabled", undefined, 503);
      const room = (
        await tx.query("SELECT * FROM rooms WHERE id=$1 AND merchant_id=$2 FOR UPDATE", [
          a.roomId,
          b.merchant_id,
        ])
      ).rows[0];
      requireThat(room, "sponsor_room_forbidden", undefined, 403);
      const binding = (
        await tx.query(
          "SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2 AND account_address=$3",
          [userId, a.chainId, a.account],
        )
      ).rows[0];
      const atomic=(await tx.query('SELECT a.* FROM atomic_accounts a JOIN wallet_bindings b ON a.binding_id=b.id WHERE a.user_id=$1 AND a.chain_id=$2 AND a.account_address=$3 AND a.owner_address=b.owner_address',[userId,a.chainId,a.account])).rows[0];
      requireThat(binding||atomic, "sponsor_account_forbidden", undefined, 403);
      const member = (
        await tx.query(
          "SELECT * FROM room_members WHERE room_id=$1 AND user_id=$2",
          [a.roomId, userId],
        )
      ).rows[0];
      requireThat(
        member || room.merchant_id === userId,
        "sponsor_member_required",
        undefined,
        403,
      );
      // This implementation only funds the actor itself or the quote escrow; no arbitrary recipient.
      const quote = (
        await tx.query("SELECT escrow FROM quote_bindings WHERE room_id=$1 UNION ALL SELECT escrow FROM protected_room_bindings WHERE room_id=$1 LIMIT 1", [
          a.roomId,
        ])
      ).rows[0];
      requireThat(
        a.recipient === a.account || a.recipient === quote?.escrow || (a.function==='publish'&&a.recipient===a.contract),
        "sponsor_recipient_forbidden",
        undefined,
        403,
      );
      const old = (
        await tx.query(
          "SELECT * FROM sponsorship_reservations WHERE idempotency_key=$1",
          [key],
        )
      ).rows[0];
      if (old) {
        const { reservedDay, ...bound } = old.authorization_data;
        requireThat(
          canonical(bound) === canonical(a),
          "sponsor_idempotency_conflict",
          undefined,
          409,
        );
        return old;
      }
      const rows = (
        await tx.query(
          "SELECT * FROM sponsorship_reservations WHERE budget_id=$1 AND status<>'released'",
          [budgetId],
        )
      ).rows;
      requireThat(
        !rows.some((r) => r.authorization_data.nonce === a.nonce),
        "sponsor_replay",
        undefined,
        409,
      );
      const day = new Date().toISOString().slice(0, 10);
      const active = rows.filter(
        (r) => r.authorization_data.reservedDay === day,
      ); // Day stored inside authorization below.
      const accountTotal = active
          .filter((r) => r.authorization_data.account === a.account)
          .reduce((n, r) => n + BigInt(r.amount), 0n),
        roomTotal = active
          .filter((r) => r.authorization_data.roomId === a.roomId)
          .reduce((n, r) => n + BigInt(r.amount), 0n);
      requireThat(
        accountTotal + BigInt(a.amount) <=
          BigInt(this.policy.maxPerAccountDay) &&
          roomTotal + BigInt(a.amount) <= BigInt(this.policy.maxPerRoomDay),
        "sponsor_daily_cap",
      );
      requireThat(
        BigInt(b.spent) + BigInt(b.reserved) + BigInt(a.amount) <=
          BigInt(b.cap),
        "sponsor_budget_exhausted",
        undefined,
        409,
      );
      if (this.policy.maxPerRoom !== undefined) {
        const committed = (await tx.query(
          "SELECT COALESCE(SUM(amount::numeric),0)::text AS total FROM sponsorship_reservations WHERE authorization_data->>'roomId'=$1 AND status<>'released'",
          [a.roomId],
        )).rows[0].total;
        requireThat(
          BigInt(committed) + BigInt(a.amount) <= BigInt(this.policy.maxPerRoom),
          "sponsor_booking_cap",
          undefined,
          409,
        );
      }
      await tx.query("UPDATE sponsorship_budgets SET reserved=$2 WHERE id=$1", [
        budgetId,
        (BigInt(b.reserved) + BigInt(a.amount)).toString(),
      ]);
      return (
        await tx.query(
          "INSERT INTO sponsorship_reservations(id,budget_id,idempotency_key,amount,status,authorization_data) VALUES($1,$2,$3,$4,'reserved',$5) RETURNING *",
          [
            id(),
            budgetId,
            key,
            a.amount,
            JSON.stringify({ ...a, reservedDay: day }),
          ],
        )
      ).rows[0];
    });
  }
  async transition(
    reservationId: string,
    status: "submitted" | "unknown" | "released" | "settled",
    actual?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const r = (
        await tx.query(
          "SELECT * FROM sponsorship_reservations WHERE id=$1 FOR UPDATE",
          [reservationId],
        )
      ).rows[0];
      requireThat(r, "reservation_not_found", undefined, 404);
      const b = (
        await tx.query(
          "SELECT * FROM sponsorship_budgets WHERE id=$1 FOR UPDATE",
          [r.budget_id],
        )
      ).rows[0];
      if (r.status === status) return r;
      requireThat(
        !["settled", "released"].includes(r.status),
        "reservation_terminal",
        undefined,
        409,
      );
      requireThat(
        !(r.status === "unknown" && status === "released"),
        "unknown_requires_verified_reconciliation",
        undefined,
        409,
      );
      if (status === "settled" || status === "released") {
        const spent = status === "settled" ? positive(actual) : "0";
        requireThat(
          BigInt(spent) <= BigInt(r.amount),
          "actual_exceeds_reserve",
        );
        await tx.query(
          "UPDATE sponsorship_budgets SET reserved=$2,spent=$3 WHERE id=$1",
          [
            b.id,
            (BigInt(b.reserved) - BigInt(r.amount)).toString(),
            (BigInt(b.spent) + BigInt(spent)).toString(),
          ],
        );
      }
      return (
        await tx.query(
          "UPDATE sponsorship_reservations SET status=$2 WHERE id=$1 RETURNING *",
          [reservationId, status],
        )
      ).rows[0];
    });
  }
}
