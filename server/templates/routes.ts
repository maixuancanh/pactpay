import type { Database, Row } from "../db/database.js";
import { id, integer, positive, requireThat, text } from "../lib.js";
import { Rooms } from "../rooms/service.js";
export class Templates {
  constructor(
    private db: Database,
    private rooms: Rooms,
  ) {}
  async list(userId: string) {
    return (
      await this.db.query(
        "SELECT * FROM templates WHERE merchant_id=$1 ORDER BY created_at DESC",
        [userId],
      )
    ).rows;
  }
  async create(userId: string, p: Row) {
    requireThat(
      ["equal", "custom"].includes(p.sharePolicy),
      "invalid_share_policy",
    );
    return (
      await this.db.query(
        "INSERT INTO templates(id,merchant_id,title,public_terms,total,share_policy,duration_minutes,slot_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          id(),
          userId,
          text(p.title, 200),
          text(p.publicTerms, 8000),
          positive(p.total),
          p.sharePolicy,
          integer(p.durationMinutes, 1, 525600),
          text(p.slotType, 100),
        ],
      )
    ).rows[0];
  }
  async duplicate(userId: string, templateId: string, p: Row) {
    const t = (
      await this.db.query(
        "SELECT * FROM templates WHERE id=$1 AND merchant_id=$2",
        [templateId, userId],
      )
    ).rows[0];
    requireThat(t, "template_not_found", undefined, 404);
    return this.rooms.create(userId, {
      title: t.title,
      publicTerms: t.public_terms,
      total: t.total,
      fundingDeadline: p.fundingDeadline,
      serviceAt: p.serviceAt,
    });
  }
}
