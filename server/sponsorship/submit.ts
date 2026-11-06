import type { Database } from "../db/database.js";
import { hex32, amount, requireThat } from "../lib.js";
import type { SponsorAuthorization } from "./policy.js";
import { SponsorBudget } from "./budget.js";
export type SponsorProof = {
  status: "not-broadcast" | "pending" | "finalized" | "failed";
  txHash?: string;
  actualExecution?: string;
  actualStorage?: string;
};
/** Implementations must verify native origin or paymaster authorization and receipt finality; never custody customer keys. */
export interface SponsorTransport {
  id: string;
  verifiedPrimitive: "native-sponsor" | "paymaster";
  evidence: string;
  submit(
    authorization: Readonly<SponsorAuthorization>,
    context: { idempotencyKey: string; reservationId: string },
  ): Promise<{ txHash: string }>;
  reconcile(context: {
    idempotencyKey: string;
    reservationId: string;
    txHash?: string;
  }): Promise<SponsorProof>;
}
export class SponsoredSubmission {
  constructor(
    private db: Database,
    private budgets: SponsorBudget,
    private transport?: SponsorTransport,
  ) {}
  private enabled(): SponsorTransport {
    requireThat(
      this.transport?.evidence &&
        ["native-sponsor", "paymaster"].includes(
          this.transport.verifiedPrimitive,
        ),
      "sponsor_transport_unverified",
      "No verified sponsor transport is configured",
      503,
    );
    return this.transport;
  }
  async submit(
    userId: string,
    budgetId: string,
    key: string,
    authorization: SponsorAuthorization,
  ) {
    const transport = this.enabled();
    const reservation = await this.budgets.reserve(
      userId,
      budgetId,
      key,
      authorization,
    );
    const claimed = await this.db.transaction(async (tx) => {
      const r = (
        await tx.query(
          "SELECT * FROM sponsorship_reservations WHERE id=$1 FOR UPDATE",
          [reservation.id],
        )
      ).rows[0];
      requireThat(
        !r.transport_id || r.transport_id === transport.id,
        "sponsor_transport_changed",
        undefined,
        409,
      );
      if (r.status !== "reserved") return false;
      // Persist unknown BEFORE calling an external signer; a crash cannot release or duplicate the reservation.
      await tx.query(
        "UPDATE sponsorship_reservations SET status='unknown',transport_id=$2 WHERE id=$1",
        [r.id, transport.id],
      );
      return true;
    });
    if (!claimed) return this.reconcile(reservation.id);
    try {
      const result = await transport.submit(
        Object.freeze({ ...authorization }),
        { idempotencyKey: key, reservationId: reservation.id },
      );
      const txHash = hex32(result.txHash);
      await this.db.query(
        "UPDATE sponsorship_reservations SET status='submitted',tx_hash=$2 WHERE id=$1 AND status='unknown'",
        [reservation.id, txHash],
      );
      return { reservationId: reservation.id, status: "submitted", txHash };
    } catch {
      // Network ambiguity retains the complete reservation. Retry only reconciles.
      return { reservationId: reservation.id, status: "unknown" };
    }
  }
  async reconcile(reservationId: string) {
    const transport = this.enabled(),
      r = (
        await this.db.query(
          "SELECT * FROM sponsorship_reservations WHERE id=$1",
          [reservationId],
        )
      ).rows[0];
    requireThat(
      r && r.transport_id === transport.id,
      "sponsor_reservation_not_found",
      undefined,
      404,
    );
    if (["settled", "released"].includes(r.status))
      return { reservationId, status: r.status, txHash: r.tx_hash };
    const proof = await transport.reconcile({
      idempotencyKey: r.idempotency_key,
      reservationId,
      txHash: r.tx_hash ?? undefined,
    });
    if (proof.status === "pending")
      return { reservationId, status: "unknown", txHash: r.tx_hash };
    if (proof.txHash) {
      hex32(proof.txHash);
      requireThat(
        !r.tx_hash || r.tx_hash === proof.txHash,
        "sponsor_reconcile_hash_mismatch",
      );
    }
    return this.db.transaction(async (tx) => {
      const current = (
        await tx.query(
          "SELECT * FROM sponsorship_reservations WHERE id=$1 FOR UPDATE",
          [reservationId],
        )
      ).rows[0];
      if (["settled", "released"].includes(current.status))
        return { reservationId, status: current.status };
      const b = (
        await tx.query(
          "SELECT * FROM sponsorship_budgets WHERE id=$1 FOR UPDATE",
          [current.budget_id],
        )
      ).rows[0];
      let actual = 0n;
      if (proof.status === "finalized" || proof.status === "failed") {
        requireThat(proof.txHash, "sponsor_receipt_hash_required");
        const execution = amount(proof.actualExecution),
          storage = amount(proof.actualStorage ?? "0");
        actual = BigInt(execution) + BigInt(storage);
        requireThat(
          actual <= BigInt(current.amount),
          "sponsor_actual_exceeds_cap",
        );
      }
      const status = proof.status === "not-broadcast" ? "released" : "settled";
      await tx.query(
        "UPDATE sponsorship_budgets SET reserved=$2,spent=$3 WHERE id=$1",
        [
          b.id,
          (BigInt(b.reserved) - BigInt(current.amount)).toString(),
          (BigInt(b.spent) + actual).toString(),
        ],
      );
      await tx.query(
        "UPDATE sponsorship_reservations SET status=$2,tx_hash=COALESCE($3,tx_hash) WHERE id=$1",
        [reservationId, status, proof.txHash ?? null],
      );
      return {
        reservationId,
        status,
        actualExecution: proof.actualExecution ?? "0",
        actualStorage: proof.actualStorage ?? "0",
      };
    });
  }
}
