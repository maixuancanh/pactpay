import { keccak256, toHex } from "viem";
import type { Database, Sql, Row } from "../db/database.js";
import {selectRoomAccount} from '../auth/atomic-account.js';
import {
  address,
  canonical,
  future,
  hash,
  hex32,
  id,
  integer,
  positive,
  requireThat,
  text,
  token,
} from "../lib.js";
export async function authorizedRoom(
  tx: Sql,
  roomId: string,
  userId: string,
  merchantOnly = false,
  lock = false,
) {
  const r = (
    await tx.query(
      `SELECT * FROM rooms WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [roomId],
    )
  ).rows[0];
  requireThat(r, "room_not_found", undefined, 404);
  const member =
    (
      await tx.query(
        "SELECT user_id FROM room_members WHERE room_id=$1 AND user_id=$2",
        [roomId, userId],
      )
    ).rows.length > 0;
  requireThat(
    r.merchant_id === userId || (!merchantOnly && member),
    "forbidden",
    undefined,
    403,
  );
  return r;
}
export function validateRoom(input: Row) {
  const fundingDeadline = future(input.fundingDeadline),
    serviceAt = future(input.serviceAt);
  requireThat(
    Date.parse(fundingDeadline) < Date.parse(serviceAt),
    "funding_must_precede_service",
  );
  const settlementVersion = input.settlementVersion ?? "v1";
  requireThat(["v1", "protected-v2"].includes(settlementVersion), "invalid_settlement_version");
  return {
    settlementVersion,
    complaintSeconds: integer(input.complaintSeconds ?? 3600, 60, 31536000),
    resolutionSeconds: integer(input.resolutionSeconds ?? 86400, 60, 31536000),
    title: text(input.title, 200),
    publicTerms: text(input.publicTerms, 8000),
    total: positive(input.total),
    fundingDeadline,
    serviceAt,
  };
}
export function editable(r: Row) {
  requireThat(
    ["draft", "inviting", "locked"].includes(r.status),
    "room_not_editable",
    undefined,
    409,
  );
}
export async function bump(tx: Sql, r: Row) {
  await tx.query(
    "UPDATE rooms SET revision=revision+1,status='inviting',terms_hash=NULL WHERE id=$1",
    [r.id],
  );
  await tx.query("DELETE FROM room_acceptances WHERE room_id=$1", [r.id]);
  await tx.query(
    "UPDATE outbox SET status='cancelled' WHERE room_id=$1 AND status IN ('pending','processing')",
    [r.id],
  );
}
export function publicTermsDocument(view: Row) {
  return canonical({
    version: view.settlementVersion === "protected-v2" ? 2 : 1,
    ...(view.settlementVersion === "protected-v2" ? {complaintSeconds:view.complaintSeconds,resolutionSeconds:view.resolutionSeconds} : {}),
    roomId: view.id,
    revision: view.revision,
    title: view.title,
    publicTerms: view.publicTerms,
    total: view.total,
    fundingDeadline: view.fundingDeadline,
    serviceAt: view.serviceAt,
    members: view.members.map((m: Row) => ({
      accountAddress: m.accountAddress,
      share: m.share,
    })),
  });
}
export async function roomView(tx: Sql, roomId: string) {
  const r = (await tx.query("SELECT * FROM rooms WHERE id=$1", [roomId]))
    .rows[0];
  requireThat(r, "room_not_found", undefined, 404);
  const members = (
    await tx.query(
      `SELECT m.*,a.revision AS accepted_revision FROM room_members m LEFT JOIN room_acceptances a ON a.room_id=m.room_id AND a.user_id=m.user_id WHERE m.room_id=$1 ORDER BY m.user_id`,
      [roomId],
    )
  ).rows;
  const q = (
    await tx.query("SELECT * FROM quote_bindings WHERE room_id=$1", [roomId])
  ).rows[0];
  const protectedBinding = (await tx.query("SELECT * FROM protected_room_bindings WHERE room_id=$1", [roomId])).rows[0];
  const view = {
    settlementVersion: r.settlement_version,
    complaintSeconds: r.complaint_seconds,
    resolutionSeconds: r.resolution_seconds,
    protectedBooking: protectedBinding ? {quoteId:protectedBinding.quote_id,escrow:protectedBinding.escrow,chainId:Number(protectedBinding.chain_id),blockNumber:protectedBinding.block_number,blockHash:protectedBinding.block_hash,txHash:protectedBinding.tx_hash} : null,
    id: r.id,
    merchantId: r.merchant_id,
    merchantAccountAddress: r.merchant_account_address ?? null,
    accountChainId: r.account_chain_id ? Number(r.account_chain_id) : null,
    title: r.title,
    publicTerms: r.public_terms,
    total: r.total,
    fundingDeadline: new Date(r.funding_deadline).toISOString(),
    serviceAt: new Date(r.service_at).toISOString(),
    revision: r.revision,
    status: r.status,
    termsHash: r.terms_hash,
    members: members.map((m) => ({
      userId: m.user_id,
      nickname: m.nickname,
      accountAddress: m.account_address,
      share: m.share,
      acceptedRevision: m.accepted_revision ?? null,
    })),
    quote: q
      ? {
          chainId: Number(q.chain_id),
          escrow: q.escrow,
          quoteId: q.quote_id,
          txHash: q.tx_hash,
          blockNumber: q.block_number,
          blockHash: q.block_hash,
          source: q.source,
        }
      : null,
  };
  return {
    ...view,
    canonicalTerms: r.terms_hash ? publicTermsDocument(view) : null,
  };
}
export class Rooms {
  constructor(
    private db: Database,
    private chainId: number,
  ) {}
  async list(userId: string) {
    const rs = (
      await this.db.query(
        "SELECT id FROM rooms WHERE merchant_id=$1 OR id IN (SELECT room_id FROM room_members WHERE user_id=$1) ORDER BY created_at DESC LIMIT 100",
        [userId],
      )
    ).rows;
    return Promise.all(rs.map((r) => roomView(this.db, r.id)));
  }
  async get(userId: string, roomId: string) {
    await authorizedRoom(this.db, roomId, userId);
    return roomView(this.db, roomId);
  }
  async create(userId: string, input: Row) {
    const v = validateRoom(input),
      roomId = id();
    return this.db.transaction(async tx=>{
    const selected=input.accountAddress===undefined?{accountAddress:(await tx.query('SELECT account_address FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2',[userId,this.chainId])).rows[0]?.account_address??null}:await selectRoomAccount(tx,userId,this.chainId,input.accountAddress);
    await tx.query(
      "INSERT INTO rooms(id,merchant_id,title,public_terms,total,funding_deadline,service_at,merchant_account_address,account_chain_id,settlement_version,complaint_seconds,resolution_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        roomId,
        userId,
        v.title,
        v.publicTerms,
        v.total,
        v.fundingDeadline,
        v.serviceAt,
        selected.accountAddress,
        this.chainId,
        v.settlementVersion, v.complaintSeconds, v.resolutionSeconds,
      ],
    );
    return roomView(tx, roomId);
    });
  }
  async edit(userId: string, roomId: string, input: Row) {
    return this.db.transaction(async (tx) => {
      const r = await authorizedRoom(tx, roomId, userId, true, true);
      editable(r);
      requireThat(
        r.revision === input.expectedRevision,
        "revision_conflict",
        undefined,
        409,
      );
      const v = validateRoom({
        title: r.title,
        publicTerms: r.public_terms,
        total: r.total,
        fundingDeadline: new Date(r.funding_deadline).toISOString(),
        serviceAt: new Date(r.service_at).toISOString(),
        ...input,
      });
      await tx.query(
        "UPDATE rooms SET title=$2,public_terms=$3,total=$4,funding_deadline=$5,service_at=$6 WHERE id=$1 AND revision=$7",
        [
          roomId,
          v.title,
          v.publicTerms,
          v.total,
          v.fundingDeadline,
          v.serviceAt,
          input.expectedRevision,
        ],
      );
      await bump(tx, r);
      return roomView(tx, roomId);
    });
  }
  async invite(userId: string, roomId: string, input: Row) {
    return this.db.transaction(async (tx) => {
      const r = await authorizedRoom(tx, roomId, userId, true, true);
      editable(r);
      const expiresAt = future(input.expiresAt),
        raw = token(),
        inviteId = id();
      requireThat(
        Date.parse(expiresAt) <= new Date(r.funding_deadline).getTime(),
        "invitation_after_deadline",
      );
      if (input.recipientUserId)
        requireThat(
          (
            await tx.query("SELECT id FROM users WHERE id=$1", [
              input.recipientUserId,
            ])
          ).rows.length,
          "recipient_not_found",
        );
      const share = input.share === undefined ? null : positive(input.share);
      if (share !== null) {
        const {rows}=await tx.query("SELECT share FROM room_members WHERE room_id=$1",[roomId]);
        requireThat(rows.reduce((sum,member)=>sum+BigInt(member.share),BigInt(share))<=BigInt(r.total),"shares_exceed_total");
      }
      await tx.query(
        "INSERT INTO invitations(id,room_id,token_hash,recipient_user_id,expires_at,assigned_share) VALUES($1,$2,$3,$4,$5,$6)",
        [inviteId, roomId, hash(raw), input.recipientUserId ?? null, expiresAt, share],
      );
      await tx.query(
        "UPDATE rooms SET status='inviting' WHERE id=$1 AND status='draft'",
        [roomId],
      );
      if (input.recipientUserId)
        await tx.query(
          `INSERT INTO outbox(id,user_id,room_id,kind,revision,payload,dedup_key) VALUES($1,$2,$3,'invitation',$4,$5,$6)`,
          [
            id(),
            input.recipientUserId,
            roomId,
            r.revision,
            JSON.stringify({ roomId }),
            `invite:${inviteId}`,
          ],
        );
      return { id: inviteId, token: raw, expiresAt };
    });
  }
  async revoke(userId: string, roomId: string, inviteId: string) {
    await authorizedRoom(this.db, roomId, userId, true);
    await this.db.query(
      "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND room_id=$2",
      [inviteId, roomId],
    );
    return { revoked: true };
  }
  async invitationRoom(userId: string, rawToken: string) {
    return (await this.invitationDetails(userId,rawToken)).room;
  }
  async invitationDetails(userId: string, rawToken: string) {
    const inv=(await this.db.query("SELECT * FROM invitations WHERE token_hash=$1",[hash(rawToken)])).rows[0];
    requireThat(inv,"invitation_not_found",undefined,404);
    const r=(await this.db.query("SELECT merchant_id,title,funding_deadline,status FROM rooms WHERE id=$1",[inv.room_id])).rows[0];
    const member=(await this.db.query("SELECT user_id FROM room_members WHERE room_id=$1 AND user_id=$2",[inv.room_id,userId])).rows[0];
    // The invitation only locates the room. Existing membership authorizes access.
    if(r?.merchant_id===userId||member)return {room:await roomView(this.db,inv.room_id),preview:null};
    requireThat(!inv.revoked_at&&Date.parse(String(inv.expires_at))>Date.now(),"invitation_expired",undefined,410);
    requireThat(!inv.recipient_user_id||inv.recipient_user_id===userId,"recipient_mismatch",undefined,403);
    editable(r);
    requireThat(new Date(r.funding_deadline).getTime()>Date.now(),"funding_closed");
    return {room:null,preview:{title:r.title,share:inv.assigned_share??null,fundingDeadline:r.funding_deadline}};
  }
  async join(userId: string, rawToken: string, input: Row) {
    return this.db.transaction(async (tx) => {
      const inv = (
        await tx.query("SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE", [
          hash(rawToken),
        ])
      ).rows[0];
      requireThat(
        inv &&
          !inv.revoked_at &&
          new Date(inv.expires_at).getTime() > Date.now(),
        "invalid_invitation",
        undefined,
        404,
      );
      requireThat(
        !inv.recipient_user_id || inv.recipient_user_id === userId,
        "recipient_mismatch",
        undefined,
        403,
      );
      const r = (
        await tx.query("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
          inv.room_id,
        ])
      ).rows[0];
      editable(r);
      requireThat(
        new Date(r.funding_deadline).getTime() > Date.now(),
        "funding_closed",
      );
      const binding = (
        await tx.query(
          "SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2",
          [userId, this.chainId],
        )
      ).rows[0];
      requireThat(binding, "wallet_binding_required", undefined, 409);
      requireThat(!r.account_chain_id||Number(r.account_chain_id)===this.chainId,'room_chain_mismatch',undefined,409);
      const selected=await selectRoomAccount(tx,userId,this.chainId,input.accountAddress);
      requireThat(r.settlement_version!=="protected-v2"||selected.accountAddress.toLowerCase()!==r.merchant_account_address?.toLowerCase(),"protected_merchant_cannot_be_buyer");
      const members = (
        await tx.query("SELECT * FROM room_members WHERE room_id=$1", [r.id])
      ).rows;
      requireThat(
        !members.some(
          (m) =>
            m.user_id === userId ||
            m.account_address === selected.accountAddress,
        ),
        "duplicate_member",
        undefined,
        409,
      );
      requireThat(members.length < 5, "member_limit");
      const share = positive(input.share);
      requireThat(inv.assigned_share==null||share===inv.assigned_share,"invitation_share_mismatch",undefined,409);
      requireThat(
        members.reduce((n, m) => n + BigInt(m.share), BigInt(share)) <=
          BigInt(r.total),
        "shares_exceed_total",
      );
      await tx.query(
        "INSERT INTO room_members(room_id,user_id,binding_id,nickname,account_address,share,atomic_account_address) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          r.id,
          userId,
          binding.id,
          text(input.nickname, 100),
          selected.accountAddress,
          share,
          selected.atomic ? selected.accountAddress : null,
        ],
      );
      if(inv.assigned_share!=null)
        await tx.query("UPDATE invitations SET revoked_at=now() WHERE id=$1",[inv.id]);
      await bump(tx, r);
      return roomView(tx, r.id);
    });
  }
  async accept(userId: string, roomId: string, revision: number) {
    return this.db.transaction(async (tx) => {
      const r = await authorizedRoom(tx, roomId, userId, false, true);
      requireThat(
        ["draft", "inviting"].includes(r.status),
        "room_not_accepting",
        undefined,
        409,
      );
      requireThat(r.revision === revision, "revision_conflict", undefined, 409);
      const m = (
        await tx.query(
          "SELECT * FROM room_members WHERE room_id=$1 AND user_id=$2",
          [roomId, userId],
        )
      ).rows[0];
      requireThat(m, "member_required", undefined, 403);
      const b = (
        await tx.query(
          "SELECT * FROM wallet_bindings WHERE id=$1 AND user_id=$2",
          [m.binding_id, userId],
        )
      ).rows[0];
      const atomic=m.atomic_account_address?(await tx.query('SELECT * FROM atomic_accounts WHERE binding_id=$1 AND user_id=$2 AND chain_id=$3 AND account_address=$4',[m.binding_id,userId,this.chainId,m.account_address])).rows[0]:null;
      requireThat(
        b && (m.atomic_account_address ? atomic?.owner_address===b.owner_address&&atomic?.account_address===m.account_address : b.account_address === m.account_address),
        "binding_changed",
        undefined,
        409,
      );
      requireThat(
        new Date(r.funding_deadline).getTime() > Date.now(),
        "funding_closed",
      );
      await tx.query(
        "INSERT INTO room_acceptances(room_id,user_id,revision) VALUES($1,$2,$3) ON CONFLICT(room_id,user_id) DO UPDATE SET revision=EXCLUDED.revision,accepted_at=now()",
        [roomId, userId, revision],
      );
      return roomView(tx, roomId);
    });
  }
  async lock(userId: string, roomId: string, revision: number) {
    return this.db.transaction(async (tx) => {
      const r = await authorizedRoom(tx, roomId, userId, true, true);
      requireThat(r.revision === revision, "revision_conflict", undefined, 409);
      if (r.status === "locked") return roomView(tx, roomId);
      requireThat(
        ["draft", "inviting"].includes(r.status),
        "invalid_room_state",
        undefined,
        409,
      );
      const view = await roomView(tx, roomId);
      requireThat(
        view.members.length >= 1 &&
          view.members.length <= 5 &&
          view.members.every((m) => m.acceptedRevision === revision),
        "acceptance_required",
      );
      requireThat(
        view.members.reduce((n, m) => n + BigInt(m.share), 0n) ===
          BigInt(view.total),
        "shares_total_mismatch",
      );
      requireThat(
        Date.parse(view.fundingDeadline) > Date.now(),
        "funding_closed",
      );
      const termsHash = keccak256(toHex(publicTermsDocument(view)));
      await tx.query(
        "UPDATE rooms SET status='locked',terms_hash=$2 WHERE id=$1",
        [roomId, termsHash],
      );
      return roomView(tx, roomId);
    });
  }
  async publish(userId: string, roomId: string, input: Row) {
    return this.db.transaction(async (tx) => {
      const r = await authorizedRoom(tx, roomId, userId, true, true);
      requireThat(
        r.revision === input.revision,
        "revision_conflict",
        undefined,
        409,
      );
      requireThat(r.settlement_version !== "protected-v2", "use_protected_checkout");
      const key = text(input.idempotencyKey, 100),
        escrow = address(input.escrow),
        quoteId = hex32(input.quoteId),
        chainId = integer(input.chainId, 1, Number.MAX_SAFE_INTEGER);
      requireThat(chainId === this.chainId, "wrong_chain");
      const old = (
        await tx.query(
          "SELECT * FROM payment_intents WHERE room_id=$1 AND revision=$2",
          [roomId, r.revision],
        )
      ).rows[0];
      if (old) {
        requireThat(
          old.idempotency_key === key &&
            old.escrow === escrow &&
            old.quote_id === quoteId,
          "publish_already_prepared",
          "Reconcile the existing publish intent before retry",
          409,
        );
        return old;
      }
      requireThat(r.status === "locked", "room_not_locked", undefined, 409);
      requireThat(
        new Date(r.funding_deadline).getTime() > Date.now(),
        "funding_closed",
      );
      const hold = (
        await tx.query(
          "SELECT * FROM inventory_holds WHERE room_id=$1 FOR UPDATE",
          [roomId],
        )
      ).rows[0];
      if (hold) {
        const memberCount = (
          await tx.query(
            "SELECT count(*) AS count FROM room_members WHERE room_id=$1",
            [roomId],
          )
        ).rows[0].count;
        requireThat(
          hold.quantity >= Number(memberCount),
          "inventory_seats_below_roster",
          undefined,
          409,
        );
        requireThat(
          hold.status === "draft" &&
            new Date(hold.expires_at).getTime() > Date.now(),
          "inventory_hold_expired",
          undefined,
          409,
        );
        await tx.query(
          "UPDATE inventory_holds SET status='funding' WHERE room_id=$1",
          [roomId],
        );
      }
      const intent = (
        await tx.query(
          `INSERT INTO payment_intents(id,room_id,revision,idempotency_key,terms_hash,chain_id,escrow,quote_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'prepared') RETURNING *`,
          [
            id(),
            roomId,
            r.revision,
            key,
            r.terms_hash,
            chainId,
            escrow,
            quoteId,
          ],
        )
      ).rows[0];
      await tx.query("UPDATE rooms SET status='publishing' WHERE id=$1", [
        roomId,
      ]);
      return intent;
    });
  }
  async submitted(
    userId: string,
    roomId: string,
    intentId: string,
    txHash: unknown,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizedRoom(tx, roomId, userId, true, true);
      const intent = (
        await tx.query(
          "SELECT * FROM payment_intents WHERE id=$1 AND room_id=$2 FOR UPDATE",
          [intentId, roomId],
        )
      ).rows[0];
      requireThat(intent, "intent_not_found", undefined, 404);
      const h = hex32(txHash);
      requireThat(
        !intent.tx_hash || intent.tx_hash === h,
        "unknown_transaction_requires_reconciliation",
        undefined,
        409,
      );
      await tx.query(
        "UPDATE payment_intents SET tx_hash=$2,status=CASE WHEN status='finalized' THEN status ELSE 'unknown' END WHERE id=$1",
        [intentId, h],
      );
      return {
        id: intentId,
        txHash: h,
        status: intent.status === "finalized" ? "finalized" : "unknown",
      };
    });
  }
}
