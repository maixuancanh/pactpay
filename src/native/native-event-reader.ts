import { decodeEventLog, type Hex } from "viem";
import abi from "../lib/pact-abi.json";
import type { HistoryEvent } from "./history";
const GENESIS =
  "0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd";
type RecordEvent = {
  phase: number;
  event: { section: string; method: string; data: any };
};
export function decodeNativeEvents(
  records: RecordEvent[],
  extrinsics: { hash: string }[],
  blockNumber: bigint,
  blockHash: string,
  contract: string,
): HistoryEvent[] {
  const success = new Set(
    records
      .filter(
        (x) =>
          x.event.section === "system" && x.event.method === "ExtrinsicSuccess",
      )
      .map((x) => x.phase),
  );
  const failed = new Set(
    records
      .filter(
        (x) =>
          x.event.section === "system" && x.event.method === "ExtrinsicFailed",
      )
      .map((x) => x.phase),
  );
  return records.flatMap((record, index) => {
    const e = record.event;
    if (
      !success.has(record.phase) ||
      failed.has(record.phase) ||
      e.section !== "revive" ||
      e.method !== "ContractEmitted" ||
      String(e.data.contract).toLowerCase() !== contract.toLowerCase()
    )
      return [];
    try {
      const decoded: any = decodeEventLog({
        abi: abi as any,
        data: e.data.data as Hex,
        topics: e.data.topics,
        strict: true,
      });
      if (!decoded.eventName) return [];
      return [
        {
          event: decoded.eventName,
          args: decoded.args,
          transactionHash: extrinsics[record.phase].hash,
          blockNumber,
          blockHash,
          logIndex: index,
          receiptStatus: "success",
        },
      ];
    } catch {
      return [];
    }
  });
}
export async function nativeHistoryPage(
  from: bigint,
  to: bigint,
  contract: string,
  target: { number: bigint; hash: string },
  cancelled: () => boolean,
) {
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const provider = new WsProvider("wss://test-node-v3.portaldot.dev", 1000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const api = await Promise.race([
    ApiPromise.create({ provider, noInitWarn: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void provider.disconnect();
        reject(Error("Native evidence connection timed out"));
      }, 15000);
    }),
  ]).finally(() => clearTimeout(timer));
  try {
    if (api.genesisHash.toHex() !== GENESIS)
      throw Error("Native evidence network mismatch");
    const finalized = await api.rpc.chain.getHeader(
      await api.rpc.chain.getFinalizedHead(),
    );
    if (BigInt(finalized.number.toString()) < target.number)
      throw Error("Native finalized head is behind the receipt target");
    const nativeTarget=await api.rpc.chain.getBlockHash(target.number.toString());
    const atTarget=await api.at(nativeTarget);
    const ethereumBlock:any=(await (atTarget.query as any).revive.ethereumBlock()).toJSON();
    if(BigInt(ethereumBlock.number)!==target.number||String(ethereumBlock.hash).toLowerCase()!==target.hash.toLowerCase())throw Error('Native/EVM runtime block mapping is unverified. Cannot merge history.');
    const result: HistoryEvent[] = [];
    for (let n = from; n <= to; n++) {
      if (cancelled()) throw Error("Native history read stopped");
      const hash = await api.rpc.chain.getBlockHash(n.toString());
      const [block, at] = await Promise.all([
        api.rpc.chain.getBlock(hash),
        api.at(hash),
      ]);
      const events: any = await at.query.system.events();
      const records = events
        .filter((r: any) => r.phase.isApplyExtrinsic)
        .map((r: any) => ({
          phase: r.phase.asApplyExtrinsic.toNumber(),
          event: {
            section: r.event.section,
            method: r.event.method,
            data: Object.fromEntries(
              r.event.meta.fields.map((f: any, i: number) => [
                f.name.isSome ? f.name.unwrap().toString() : String(i),
                r.event.data[i].toJSON(),
              ]),
            ),
          },
        }));
      result.push(
        ...decodeNativeEvents(
          records,
          block.block.extrinsics.map((x) => ({ hash: x.hash.toHex() })),
          n,
          hash.toHex(),
          contract,
        ),
      );
    }
    return result;
  } finally {
    await api.disconnect();
  }
}
