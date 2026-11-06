import { describe, expect, it } from "vitest";
import {
  historyCoverage,
  scanHistoryBatch,
  type HistoryProgress,
} from "./history";
const start = (): HistoryProgress => ({
  fromBlock: 10n,
  targetBlock: 2600n,
  targetHash: "0xabc",
  nextBlock: 10n,
  events: [],
});
const created = {
  event: "QuoteCreated",
  args: { quoteId: "0x123" },
  transactionHash: "0x1",
  blockNumber: 12n,
  blockHash: "0xa",
  logIndex: 0,
  receiptStatus: "success",
};
describe("resumable finalized receipt history", () => {
  it("pins target and continues past 2000 blocks without losing creation", async () => {
    let progress = start();
    const ranges: bigint[][] = [];
    const read = async (from: bigint, to: bigint) => {
      ranges.push([from, to]);
      return from === 10n ? [created] : [];
    };
    progress = await scanHistoryBatch(
      progress,
      read,
      () => {},
      () => false,
    );
    expect(progress.nextBlock).toBe(2010n);
    expect(historyCoverage(progress, "0x123").status).toBe("partial");
    progress = await scanHistoryBatch(
      progress,
      read,
      () => {},
      () => false,
    );
    expect(historyCoverage(progress, "0x123").completeFromDeployment).toBe(
      true,
    );
    expect(progress.targetBlock).toBe(2600n);
    expect(ranges.every(([a, b]) => b - a < 250n)).toBe(true);
    expect(progress.events).toHaveLength(1);
  });
  it("does not trust configured start as creation proof", () => {
    expect(
      historyCoverage({ ...start(), nextBlock: 2601n }, "0x123")
        .completeFromDeployment,
    ).toBe(false);
  });
  it("retains prior verified pages on RPC failure and retries failed page", async () => {
    let saved = start();
    await expect(
      scanHistoryBatch(
        saved,
        async (from) => {
          if (from === 260n) throw Error("offline");
          return [created];
        },
        (value) => {
          saved = value;
        },
        () => false,
      ),
    ).rejects.toThrow("offline");
    expect(saved.nextBlock).toBe(260n);
    expect(saved.events).toHaveLength(1);
    expect(historyCoverage(saved, "0x123").status).toBe("partial-error");
    saved = await scanHistoryBatch(
      saved,
      async () => [],
      () => {},
      () => false,
    );
    expect(saved.error).toBeUndefined();
    expect(saved.events).toHaveLength(1);
  });
  it("cancels without declaring unverified page coverage", async () => {
    let cancel = false;
    const result = await scanHistoryBatch(
      start(),
      async () => {
        cancel = true;
        return [created];
      },
      () => {},
      () => cancel,
    );
    expect(result.nextBlock).toBe(10n);
    expect(historyCoverage(result, "0x123").status).toBe("partial");
  });
});
