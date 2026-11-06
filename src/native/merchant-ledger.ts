import type { NativeQuotePackage } from "./packages";
import { isSnapshotFresh } from "./live-state";
import { settlementSummary } from "./payment-timeline";
export type OrderRead = {
  state: number;
  held: bigint;
  now: bigint;
  at: number;
  merchantCredit?: bigint;
  fundedMembers?: number;
  collected?: bigint;
  refundCredit?: bigint;
  blockHash?: string;
  blockNumber?: string;
};
export function orderReference(id: string, ids: string[]) {
  let length = 10;
  while (
    length < id.length &&
    ids.some(
      (other) =>
        other !== id &&
        other.slice(0, length).toLowerCase() ===
          id.slice(0, length).toLowerCase(),
    )
  )
    length += 2;
  return "PP-" + id.slice(2, length).toUpperCase();
}
export function ledgerRow(
  p: NativeQuotePackage,
  read: OrderRead | undefined,
  now: number,
  ids: string[],
  evidence?: any,
) {
  const fresh = !!read && isSnapshotFresh(read.at, now, false);
  const expiry =
    fresh &&
    ((read.state === 1 && read.now >= p.quote.fundingDeadline) ||
      (read.state === 2 && read.now >= p.quote.captureDeadline));
  const action = !fresh
    ? "Refresh to verify"
    : expiry
      ? "Process expiry"
      : read.state === 2
        ? "Capture collection"
        : read.state === 3 && (read.merchantCredit ?? 0n) > 0n
          ? "Claim merchant credit"
          : read.state >= 4 && (read.refundCredit ?? 0n) > 0n
            ? "Members have refunds to claim"
            : read.state === 1
              ? "Collect remaining shares"
              : read.state >= 3
                ? "Review settlement evidence"
                : "Refresh to verify";
  return {
    id: p.id,
    reference: orderReference(p.id, ids),
    title: p.terms.title,
    merchant: p.quote.merchant,
    total: p.quote.total.toString(),
    currency: "dUSD",
    state: fresh ? String(read.state) : "unknown",
    moneyStatus:
      evidence?.id === p.id ? settlementSummary(evidence).status : "unverified",
    evidenceCoverage:
      evidence?.id === p.id
        ? settlementSummary(evidence).coverage
        : "not-scanned",
    evidenceBlock: evidence?.id === p.id ? String(evidence.finalizedBlock) : "",
    evidenceBlockHash: evidence?.id === p.id ? String(evidence.blockHash) : "",
    evidenceSource:
      evidence?.id === p.id ? (evidence.historySource ?? "evm") : "",
    held: fresh ? read.held.toString() : "",
    merchantCredit:
      fresh && read.merchantCredit !== undefined
        ? read.merchantCredit.toString()
        : "",
    fundedMembers: fresh ? String(read.fundedMembers ?? "") : "",
    memberCount: p.members.length,
    remaining:
      fresh && read.collected !== undefined
        ? (p.quote.total > read.collected
            ? p.quote.total - read.collected
            : 0n
          ).toString()
        : "",
    refundCredit:
      fresh && read.refundCredit !== undefined
        ? read.refundCredit.toString()
        : "",
    fundingDeadline: String(p.quote.fundingDeadline),
    captureDeadline: String(p.quote.captureDeadline),
    blockHash: read?.blockHash ?? "",
    blockNumber: read?.blockNumber ?? "",
    checkedAt: read ? new Date(read.at).toISOString() : "",
    fresh,
    action,
    coverage:
      "Saved agreements only; finalized state per order, not a complete merchant history",
  };
}
export type LedgerRow = ReturnType<typeof ledgerRow>;
export function ledgerCsv(rows: LedgerRow[]) {
  const fields = [
    "id",
    "reference",
    "title",
    "merchant",
    "total",
    "currency",
    "state",
    "moneyStatus",
    "evidenceCoverage",
    "evidenceBlock",
    "evidenceBlockHash",
    "evidenceSource",
    "held",
    "merchantCredit",
    "refundCredit",
    "remaining",
    "fundedMembers",
    "memberCount",
    "fundingDeadline",
    "captureDeadline",
    "blockNumber",
    "blockHash",
    "checkedAt",
    "fresh",
    "action",
    "coverage",
  ] as const;
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      fields
        .map((key) =>
          cell(
            [
              "total",
              "held",
              "merchantCredit",
              "refundCredit",
              "remaining",
            ].includes(key)
              ? key + "BaseUnits_6Decimals"
              : key,
          ),
        )
        .join(","),
      ...rows.map((row) => fields.map((key) => cell(row[key])).join(",")),
    ].join("\r\n")
  );
}
