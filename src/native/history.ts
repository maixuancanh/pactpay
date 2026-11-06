export type HistoryEvent = {
  event: string;
  args: any;
  transactionHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  receiptStatus: string;
};
export type HistoryProgress = {
  fromBlock: bigint;
  targetBlock: bigint;
  targetHash: string;
  nextBlock: bigint;
  events: HistoryEvent[];
  error?: string;
};
export function historyCoverage(progress: HistoryProgress, quoteId: string) {
  const creation = progress.events.find(
    (event) =>
      event.event === "QuoteCreated" &&
      String(event.args.quoteId).toLowerCase() === quoteId.toLowerCase(),
  );
  const reachedTarget = progress.nextBlock > progress.targetBlock;
  return {
    fromBlock: progress.fromBlock,
    toBlock:
      progress.nextBlock > progress.fromBlock ? progress.nextBlock - 1n : null,
    targetBlock: progress.targetBlock,
    targetHash: progress.targetHash,
    nextBlock: reachedTarget ? null : progress.nextBlock,
    reachedTarget,
    creationEventVerified: Boolean(creation),
    creationBlock: creation?.blockNumber ?? null,
    completeFromDeployment:
      reachedTarget && Boolean(creation) && !progress.error,
    status: progress.error
      ? "partial-error"
      : reachedTarget && creation
        ? "complete"
        : "partial",
    error: progress.error ?? null,
  };
}
/** Commit only entire verified pages; retries begin at the first unverified page. */
export async function scanHistoryBatch(
  progress: HistoryProgress,
  readPage: (from: bigint, to: bigint) => Promise<HistoryEvent[]>,
  publish: (progress: HistoryProgress) => void,
  cancelled: () => boolean,
  maxPages = 8,
  pageSize=250n,
) {
  let current: HistoryProgress = { ...progress, error: undefined };
  for (
    let page = 0;
    page < maxPages && current.nextBlock <= current.targetBlock;
    page++
  ) {
    if (cancelled()) return current;
    const from = current.nextBlock,
      to =
        from + pageSize-1n < current.targetBlock ? from + pageSize-1n : current.targetBlock;
    try {
      const events = await readPage(from, to);
      if (cancelled()) return current;
      const unique = new Map(
        current.events.map((event) => [
          `${event.transactionHash}:${event.logIndex}`,
          event,
        ]),
      );
      for (const event of events)
        unique.set(`${event.transactionHash}:${event.logIndex}`, event);
      current = {
        ...current,
        nextBlock: to + 1n,
        events: [...unique.values()],
      };
      publish(current);
    } catch (error) {
      current = { ...current, error: (error as Error).message };
      publish(current);
      throw error;
    }
  }
  return current;
}
