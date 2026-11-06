import { createPublicClient, http, parseAbi, decodeEventLog } from "viem";
import type { Database } from "../db/database.js";
import { hex32, id, requireThat } from "../lib.js";
const erc20 = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export type FinalizedTransfer = {
  chainId: number;
  token: string;
  from: string;
  to: string;
  amount: string;
  txHash: string;
  blockHash: string;
  blockNumber: string;
};
export async function verifyRefundTransfer(
  db: Database,
  requestId: string,
  read: (txHash: `0x${string}`) => Promise<FinalizedTransfer>,
) {
  const request = (
    await db.query("SELECT * FROM support_requests WHERE id=$1", [requestId])
  ).rows[0];
  requireThat(
    request?.status === "transfer-pending" && request.transfer_hash,
    "refund_not_pending",
  );
  const proof = await read(hex32(request.transfer_hash) as `0x${string}`);
  return db.transaction(async (tx) => {
    const r = (
      await tx.query("SELECT * FROM support_requests WHERE id=$1 FOR UPDATE", [
        requestId,
      ])
    ).rows[0];
    requireThat(
      r.status === "transfer-pending" && r.transfer_hash === proof.txHash,
      "refund_state_changed",
      undefined,
      409,
    );
    const q = (
        await tx.query("SELECT * FROM quote_bindings WHERE room_id=$1", [
          r.room_id,
        ])
      ).rows[0],
      room = (
        await tx.query("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
          r.room_id,
        ])
      ).rows[0],
      member = (
        await tx.query(
          "SELECT * FROM room_members WHERE room_id=$1 AND user_id=$2",
          [r.room_id, r.user_id],
        )
      ).rows[0],
      merchant = (
        await tx.query(
          "SELECT account_address FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2",
          [room.merchant_id, q.chain_id],
        )
      ).rows[0];
    const created = (
      await tx.query(
        "SELECT payload FROM chain_events WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 AND kind='QuoteCreated' LIMIT 1",
        [q.chain_id, q.escrow, q.quote_id],
      )
    ).rows[0];
    requireThat(
      Number(q.chain_id) === proof.chainId &&
        proof.from === merchant.account_address &&
        proof.to === member.account_address &&
        proof.amount === r.amount &&
        created?.payload.verifiedToken === proof.token,
      "refund_transfer_mismatch",
    );
    requireThat(/^0x[0-9a-f]{40}$/.test(proof.token), "invalid_token_proof");
    hex32(proof.blockHash);
    await tx.query(
      "UPDATE support_requests SET status='refunded',verified_amount=$2 WHERE id=$1",
      [requestId, proof.amount],
    );
    await tx.query(
      "INSERT INTO support_audit(id,request_id,actor_id,kind) VALUES($1,$2,$3,$4)",
      [
        id(),
        requestId,
        room.merchant_id,
        `verified-transfer:${proof.blockNumber}:${proof.blockHash}`,
      ],
    );
    return { requestId, proof };
  });
}
export function evmRefundReader(
  rpc: string,
  chainId: number,
  token: `0x${string}`,
) {
  const client = createPublicClient({
    transport: http(rpc, { timeout: 15000 }),
  });
  return async (txHash: `0x${string}`): Promise<FinalizedTransfer> => {
    requireThat((await client.getChainId()) === chainId, "wrong_refund_chain");
    const receipt = await client.getTransactionReceipt({ hash: txHash }),
      finalized = await client.getBlock({ blockTag: "finalized" });
    requireThat(
      receipt.status === "success" &&
        finalized.number !== null &&
        receipt.blockNumber <= finalized.number,
      "refund_not_finalized",
    );
    const canonical = await client.getBlock({
      blockNumber: receipt.blockNumber,
    });
    requireThat(canonical.hash === receipt.blockHash, "refund_block_mismatch");
    const transfers = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== token.toLowerCase()) continue;
      try {
        const e = decodeEventLog({
          abi: erc20,
          data: log.data,
          topics: log.topics,
        });
        transfers.push(e.args);
      } catch {}
    }
    requireThat(transfers.length === 1, "ambiguous_refund_transfer");
    const t = transfers[0];
    return {
      chainId,
      token: token.toLowerCase(),
      from: t.from.toLowerCase(),
      to: t.to.toLowerCase(),
      amount: t.value.toString(),
      txHash,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber.toString(),
    };
  };
}
