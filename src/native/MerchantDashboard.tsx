import { formatUnits } from "viem";
import { ledgerCsv, type LedgerRow } from "./merchant-ledger";
import MerchantProfile from "./MerchantProfile";
export default function MerchantDashboard({
  rows,
  account,
}: {
  rows: LedgerRow[];
  account?: string;
}) {
  const mine = account
    ? rows.filter((row) => row.merchant.toLowerCase() === account.toLowerCase())
    : [];
  function exportRows() {
    const url = URL.createObjectURL(
      new Blob([ledgerCsv(mine)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "pactpay-merchant-ledger.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="native-checkout" aria-label="Merchant overview">
      <h3>Merchant overview</h3>
      {!account ? (
        <p>Connect your merchant wallet to show your saved orders.</p>
      ) : (
        <>
          <MerchantProfile account={account} rows={mine} />
          <p>
            {mine.length} saved orders ·{" "}
            {mine.filter((row) => row.fresh).length} with fresh reads
          </p>
          <p>
            Scope: saved agreements in this browser. Reads cover the current
            page and are not a complete merchant history or proof of service
            quality. Amounts are pinned per order; different orders may use
            different finalized blocks.
          </p>
          <button disabled={!mine.length} onClick={exportRows}>
            Export merchant CSV
          </button>
          {mine.map((row) => (
            <article key={row.id}>
              <strong>
                {row.reference} · {row.title}
              </strong>
              <p>{row.action}</p>
              <p>
                Money evidence: {row.moneyStatus} · history{" "}
                {row.evidenceCoverage}
                {row.evidenceBlock ? ` through block ${row.evidenceBlock}` : ""}
                . Verify each order snapshot below to include its transfer
                history in CSV.
              </p>
              <p>
                {row.fundedMembers || "?"} / {row.memberCount} members funded ·
                remaining{" "}
                {row.remaining === ""
                  ? "unknown"
                  : formatUnits(BigInt(row.remaining), 6)}{" "}
                dUSD
              </p>
              <p>
                Total {formatUnits(BigInt(row.total), 6)} dUSD · held{" "}
                {row.held === "" ? "unknown" : formatUnits(BigInt(row.held), 6)}{" "}
                · merchant claimable{" "}
                {row.merchantCredit === ""
                  ? "unknown"
                  : formatUnits(BigInt(row.merchantCredit), 6)}{" "}
                · refunds claimable{" "}
                {row.refundCredit === ""
                  ? "unknown"
                  : formatUnits(BigInt(row.refundCredit), 6)}
              </p>
              <p>
                Funding deadline:{" "}
                {new Date(Number(row.fundingDeadline) * 1000).toISOString()} ·
                capture deadline:{" "}
                {new Date(Number(row.captureDeadline) * 1000).toISOString()}
              </p>
              <small>
                {row.checkedAt
                  ? `Checked ${row.checkedAt}${row.fresh ? "" : " (stale)"}`
                  : "Not checked"}
              </small>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
