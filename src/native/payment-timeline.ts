import { claimKindFromEvents } from "./payment-snapshot";
export type TimelineEntry = {
  kind: string;
  label: string;
  amount?: string;
  recipient?: string;
  transactionHash?: string;
  blockNumber: string;
  key: string;
  verified: boolean;
};
export function verifiedEvents(snapshot: any) {
  const unique = new Map<string, any>();
  for (const e of snapshot.events ?? [])
    if (
      e.receiptStatus === "success" &&
      String(e.args?.quoteId).toLowerCase() ===
        String(snapshot.id).toLowerCase() &&
      BigInt(e.blockNumber) <= BigInt(snapshot.finalizedBlock)
    )
      unique.set(`${e.transactionHash}:${e.logIndex}`, e);
  return [...unique.values()].sort((a, b) =>
    BigInt(a.blockNumber) < BigInt(b.blockNumber)
      ? -1
      : BigInt(a.blockNumber) > BigInt(b.blockNumber)
        ? 1
        : a.logIndex - b.logIndex,
  );
}
export function paymentTimeline(snapshot: any): TimelineEntry[] {
  let phase = 0;
  return verifiedEvents(snapshot).flatMap((e) => {
    const amount =
        e.args.amount === undefined ? undefined : String(e.args.amount),
      base = {
        amount,
        transactionHash: e.transactionHash,
        blockNumber: String(e.blockNumber),
        key: `${e.transactionHash}:${e.logIndex}`,
        verified: true,
      };
    if (e.event === "QuoteCreated")
      return [{ ...base, kind: "created", label: "Agreement created" }];
    if (e.event === "Contributed")
      return [
        {
          ...base,
          kind: "contribution",
          label: "Fixed share contributed",
          recipient: e.args.member,
        },
      ];
    if (e.event === "Withdrawn")
      return [
        {
          ...base,
          kind: "withdrawal",
          label: "Contribution withdrawn",
          recipient: e.args.member,
        },
      ];
    if (e.event === "StateChanged") {
      phase = Number(e.args.state);
      const kind = (
        { 2: "funded", 3: "capture", 4: "cancelled", 5: "expired" } as Record<
          number,
          string
        >
      )[phase];
      return kind
        ? [
            {
              ...base,
              kind,
              label: (
                {
                  2: "All shares funded",
                  3: "Captured; merchant credit created",
                  4: "Cancelled; contributor refund credits created",
                  5: "Expired; contributor refund credits created",
                } as Record<number, string>
              )[phase],
            },
          ]
        : [];
    }
    if (e.event === "Claimed") {
      const payout =
        phase === 3 &&
        String(e.args.recipient).toLowerCase() ===
          String(snapshot.merchant).toLowerCase();
      const refund = phase === 4 || phase === 5;
      return [
        {
          ...base,
          kind: payout ? "payout" : refund ? "refund" : "transfer",
          label: payout
            ? "Merchant payout transferred"
            : refund
              ? "Contributor refund transferred"
              : "Claim transfer; preceding state outside verified range",
          recipient: e.args.recipient,
        },
      ];
    }
    return [];
  });
}
export function settlementSummary(snapshot: any) {
  const events = verifiedEvents(snapshot),
    state = snapshot.state,
    coverage = snapshot.historyCoverage?.status ?? "partial";
  let status =
    state === "Funding"
      ? "collecting"
      : state === "Ready"
        ? "ready"
        : "closed-unverified";
  if (state === "Captured")
    status =
      claimKindFromEvents(
        events,
        3,
        snapshot.id,
        snapshot.merchant,
        snapshot.merchant,
        BigInt(snapshot.total),
      ) === "merchant-payout"
        ? "payout-verified"
        : BigInt(snapshot.merchantCredit ?? 0) > 0n
          ? "payout-available"
          : "closed-unverified";
  if (state === "Cancelled" || state === "Expired") {
    const pending = (snapshot.members ?? []).reduce(
      (s: bigint, m: any) => s + BigInt(m.claimable ?? 0),
      0n,
    );
    const net = new Map<string, bigint>();
    for (const e of events) {
      const member = String(e.args.member ?? "").toLowerCase();
      if (e.event === "Contributed" || e.event === "Withdrawn")
        net.set(
          member,
          (net.get(member) ?? 0n) +
            (e.event === "Contributed" ? 1n : -1n) * BigInt(e.args.amount),
        );
    }
    const contributors = [...net].filter(([, amount]) => amount > 0n);
    status =
      pending > 0n
        ? "refund-available"
        : coverage === "complete" &&
            contributors.length > 0 &&
            contributors.every(
              ([address, amount]) =>
                claimKindFromEvents(
                  events,
                  4,
                  snapshot.id,
                  address,
                  snapshot.merchant,
                  amount,
                ) === "contributor-refund",
            )
          ? "refund-verified"
          : "closed-unverified";
  }
  return {
    status,
    coverage,
    blockNumber: String(snapshot.finalizedBlock),
    blockHash: String(snapshot.blockHash),
    source: snapshot.historySource ?? "evm",
  };
}
