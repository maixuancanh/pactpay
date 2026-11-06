import {
  createPublicClient,
  http,
  parseAbi,
  decodeEventLog,
  type Abi,
} from "viem";
import type { ChainReader, ChainEvent } from "./worker.js";
import { requireThat } from "../lib.js";
export const v1EventAbi = parseAbi([
  "event QuoteCreated(bytes32 indexed quoteId,address indexed merchant,bytes32 termsHash,uint256 total,uint64 fundingDeadline,uint64 captureDeadline)",
  "event Contributed(bytes32 indexed quoteId,address indexed member,uint256 amount)",
  "event Withdrawn(bytes32 indexed quoteId,address indexed member,uint256 amount)",
  "event StateChanged(bytes32 indexed quoteId,uint8 state)",
  "event Claimed(bytes32 indexed quoteId,address indexed recipient,uint256 amount)",
]);
export const v2EventAbi = parseAbi([
  "event Created(bytes32 indexed bookingId,address indexed merchant,bytes32 termsHash)",
  "event Funded(bytes32 indexed bookingId,address indexed member,uint256 amount)",
  "event Captured(bytes32 indexed bookingId,uint256 complaintDeadline,uint256 resolutionDeadline)",
  "event Disputed(bytes32 indexed bookingId,address indexed member)",
  "event Settled(bytes32 indexed bookingId,address indexed member,uint256 refund,uint256 payout)",
  "event Claimed(address indexed recipient,uint256 amount)",
]);
const reads = parseAbi([
  "function getQuote(bytes32 id) view returns ((address merchant,address token,uint256 nonce,bytes32 termsHash,bytes32 membersHash,bytes32 sharesHash,uint256 total,uint64 fundingDeadline,uint64 captureDeadline) terms,uint8 state,uint256 held,address[] members)",
  "function shares(bytes32 id,address member) view returns (uint256)",
]);
export function evmReader(
  rpc: string,
  chainId: number,
  escrow: `0x${string}`,
  version: "V1" | "V2" = "V1",
): ChainReader {
  const client = createPublicClient({
    transport: http(rpc, { timeout: 15000, retryCount: 2 }),
  });
  return {
    async readFinalized(from, limit) {
      requireThat((await client.getChainId()) === chainId, "rpc_wrong_chain");
      const finalized = await client.getBlock({ blockTag: "finalized" });
      requireThat(
        finalized.number !== null && finalized.hash && finalized.number >= from,
        "no_finalized_page",
        undefined,
        503,
      );
      const to =
        from + BigInt(limit) - 1n < finalized.number
          ? from + BigInt(limit) - 1n
          : finalized.number;
      const block = await client.getBlock({ blockNumber: to });
      requireThat(block.hash, "block_hash_missing");
      const logs = await client.getLogs({
        address: escrow,
        fromBlock: from,
        toBlock: to,
      });
      const coverage = {
        from: from.toString(),
        to: to.toString(),
        finality: "finalized",
        source: "evm-rpc",
        archive: "unknown",
      };
      const events: ChainEvent[] = [];
      for (const log of logs) {
        let decoded;
        try {
          decoded = decodeEventLog({
            abi: (version === "V1" ? v1EventAbi : v2EventAbi) as Abi,
            data: log.data,
            topics: log.topics,
          });
        } catch {
          continue;
        }
        const payload = JSON.parse(
          JSON.stringify(decoded.args, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
        );
        for (const key of ["merchant", "member", "recipient"])
          if (payload[key]) payload[key] = payload[key].toLowerCase();
        if (version === "V1" && decoded.eventName === "QuoteCreated") {
          const q = await client.readContract({
            address: escrow,
            abi: reads,
            functionName: "getQuote",
            args: [payload.quoteId],
            blockNumber: log.blockNumber!,
          });
          payload.verifiedToken = q[0].token.toLowerCase();
          payload.verifiedMembers = q[3].map((a) => a.toLowerCase());
          payload.verifiedShares = await Promise.all(
            q[3].map(async (member) =>
              (
                await client.readContract({
                  address: escrow,
                  abi: reads,
                  functionName: "shares",
                  args: [payload.quoteId, member],
                  blockNumber: log.blockNumber!,
                })
              ).toString(),
            ),
          );
        }
        events.push({
          chainId,
          txHash: log.transactionHash!,
          logIndex: log.logIndex!,
          blockNumber: log.blockNumber!.toString(),
          blockHash: log.blockHash!,
          escrow: escrow.toLowerCase(),
          quoteId:
            payload.quoteId ?? payload.bookingId ?? `0x${"0".repeat(64)}`,
          kind: decoded.eventName!,
          payload,
          source: "evm-rpc-finalized",
          coverage,
          contractVersion: version,
        });
      }
      return {
        chainId,
        from: from.toString(),
        to: to.toString(),
        blockHash: block.hash,
        events,
        coverage,
      };
    },
  };
}
