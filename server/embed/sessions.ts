import type { Database, Row, Sql } from "../db/database.js";
import { id, integer, requireThat, token } from "../lib.js";
import { authorizedRoom } from "../rooms/service.js";
export class EmbedSessions {
  constructor(
    private db: Database,
    private allowedOrigins: string[],
  ) {}
  async create(userId: string, p: Row) {
    return this.db.transaction(async (tx) => {
      await authorizedRoom(tx, p.roomId, userId, true, true);
      requireThat(
        this.allowedOrigins.includes(p.merchantOrigin),
        "embed_origin_not_allowed",
        undefined,
        403,
      );
      const q = (
        await tx.query("SELECT * FROM quote_bindings WHERE room_id=$1", [
          p.roomId,
        ])
      ).rows[0];
      requireThat(q, "finalized_quote_required", undefined, 409);
      const ttl = integer(p.ttlSeconds ?? 600, 30, 900),
        sessionId = token();
      await tx.query(
        "INSERT INTO embed_sessions(id,merchant_id,room_id,merchant_origin,nonce,expires_at,chain_id,escrow,quote_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          sessionId,
          userId,
          p.roomId,
          p.merchantOrigin,
          token(),
          new Date(Date.now() + ttl * 1000),
          q.chain_id,
          q.escrow,
          q.quote_id,
        ],
      );
      return this.get(sessionId, tx);
    });
  }
  async get(sessionId: string, sql: Sql = this.db) {
    const r = (
      await sql.query(
        "SELECT * FROM embed_sessions WHERE id=$1 AND expires_at>now()",
        [sessionId],
      )
    ).rows[0];
    requireThat(
      r && this.allowedOrigins.includes(r.merchant_origin),
      "embed_session_not_found",
      undefined,
      404,
    );
    return {
      id: r.id,
      merchantOrigin: r.merchant_origin,
      nonce: r.nonce,
      roomId: r.room_id,
      expiresAt: new Date(r.expires_at).toISOString(),
      quoteId: r.quote_id,
      chainId: Number(r.chain_id),
      escrow: r.escrow,
    };
  }
}
