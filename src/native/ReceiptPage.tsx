import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
  parseShareFragment,
  MAX_TRANSFER_BYTES,
  type NativeTransferBundle,
} from "./portability";
import { parseNativePackage } from "./packages";
import { receiptBundle } from "./receipt-package";
import OrderEvidence from "./OrderEvidence";
import AttendancePanel from './AttendancePanel';
import "./native.css";
export default function ReceiptPage() {
  const [bundle, setBundle] = useState<NativeTransferBundle | null>(null),
    [error, setError] = useState(""),
    [raw, setRaw] = useState("");
  useEffect(() => {
    try {
      const shared = parseShareFragment(location.hash);
      if (shared) setBundle(receiptBundle(JSON.stringify(shared)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  function preview(value: string) {
    setBundle(null);
    setError("");
    try {
      setBundle(receiptBundle(value));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const quote = bundle
    ? parseNativePackage(bundle.agreements[0], bundle.deployment)
    : null;
  return (
    <main className="native-app">
      <header className="native-header">
        <a href="/native">PactPay workspace</a>
        <span>Read-only receipt</span>
      </header>
      <section className="native-panel">
        <h1>Verify a payment receipt</h1>
        <p>
          No wallet connection or signature is needed. Open an agreement file or
          shared receipt link, then explicitly verify chain data.
        </p>
        <label>
          Agreement transfer file
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              setBundle(null);
              setError("");
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > MAX_TRANSFER_BYTES) {
                setError("File is too large.");
                return;
              }
              try {
                preview(await file.text());
              } catch (x) {
                setError((x as Error).message);
              }
            }}
          />
        </label>
        <label>
          Agreement transfer JSON
          <textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setBundle(null);
              setError("");
            }}
          />
        </label>
        <button disabled={!raw.trim()} onClick={() => preview(raw)}>
          Preview receipt agreement
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
      {bundle && quote && (
        <>
          <section className="native-panel">
            <h2>{quote.terms.title}</h2>
            <p>{quote.terms.description}</p>
            <p>Merchant name (self-declared): {quote.terms.merchantName}</p>
            <p>
              Merchant wallet: <code>{quote.quote.merchant}</code>
            </p>
            <p>Agreement total: {formatUnits(quote.quote.total, 6)} dUSD</p>
            <p>
              Agreement content hashes match the supplied package. Deployment
              identity comes from the sender; chain verification checks
              consistency, not merchant identity or service quality.
            </p>
            <p>
              Capture creates credit. Claim transfers tokens. Payment evidence
              does not prove delivery or attendance.
            </p>
            <button onClick={() => window.print()}>Print this page</button>
          </section>
          <OrderEvidence config={bundle.deployment} quote={quote} receiptOnly />
          <AttendancePanel quote={quote}/>
        </>
      )}
    </main>
  );
}
