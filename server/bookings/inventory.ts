import type { Database, Row } from "../db/database.js";
import { future, id, integer, requireThat, text } from "../lib.js";
import { authorizedRoom } from "../rooms/service.js";
export class Inventory {
  constructor(private db: Database) {}
  async list(userId: string) {
    return (
      await this.db.query(
        "SELECT * FROM inventory_slots WHERE merchant_id=$1 ORDER BY service_at",
        [userId],
      )
    ).rows;
  }
  async create(userId: string, input: Row) {
    return (
      await this.db.query(
        "INSERT INTO inventory_slots(id,merchant_id,label,capacity,service_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          id(),
          userId,
          text(input.label, 200),
          integer(input.capacity, 1, 100000),
          future(input.serviceAt),
        ],
      )
    ).rows[0];
  }
  async reserve(userId: string, roomId: string, input: Row) {
    return this.db.transaction(async (tx) => {
      const r = await authorizedRoom(tx, roomId, userId, true, true);
      requireThat(
        ["draft", "inviting", "locked"].includes(r.status),
        "room_not_reservable",
      );
      const slot = (
        await tx.query("SELECT * FROM inventory_slots WHERE id=$1 FOR UPDATE", [
          input.slotId,
        ])
      ).rows[0];
      requireThat(
        slot && slot.merchant_id === userId,
        "slot_forbidden",
        undefined,
        403,
      );
      requireThat(
        new Date(r.funding_deadline) < new Date(slot.service_at),
        "funding_after_service",
      );
      requireThat(
        new Date(r.service_at).getTime() ===
          new Date(slot.service_at).getTime(),
        "slot_time_mismatch",
      );
      const quantity = integer(input.quantity, 1, 5),
        ttl = integer(input.ttlSeconds ?? 900, 30, 3600);
      await tx.query(
        "UPDATE inventory_holds SET status='released' WHERE slot_id=$1 AND status='draft' AND expires_at<=now()",
        [slot.id],
      );
      const old = (
        await tx.query("SELECT * FROM inventory_holds WHERE room_id=$1", [
          roomId,
        ])
      ).rows[0];
      requireThat(
        !old || ["draft", "released"].includes(old.status),
        "funding_hold_immutable",
        undefined,
        409,
      );
      const used = (
        await tx.query(
          "SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory_holds WHERE slot_id=$1 AND status<>'released' AND room_id<>$2",
          [slot.id, roomId],
        )
      ).rows[0];
      requireThat(
        Number(used.quantity) + quantity <= slot.capacity,
        "inventory_full",
        undefined,
        409,
      );
      return (
        await tx.query(
          `INSERT INTO inventory_holds(id,slot_id,room_id,quantity,status,expires_at) VALUES($1,$2,$3,$4,'draft',$5) ON CONFLICT(room_id) DO UPDATE SET slot_id=EXCLUDED.slot_id,quantity=EXCLUDED.quantity,status='draft',expires_at=EXCLUDED.expires_at RETURNING *`,
          [id(), slot.id, roomId, quantity, new Date(Date.now() + ttl * 1000)],
        )
      ).rows[0];
    });
  }
  // No public endpoint can release a funding reservation. Only finalized chain evidence does.
}
