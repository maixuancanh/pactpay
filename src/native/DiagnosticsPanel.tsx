import { useState } from "react";
import { diagnostics, type DiagnosticInput } from "./diagnostics";
export default function DiagnosticsPanel({
  error,
  contract,
  quoteId,
  actionCode,
  runtimeVersion,
  blockNumber,
  transactionHash,
}: Omit<DiagnosticInput, "version">) {
  const [include, setInclude] = useState(false);
  const output = JSON.stringify(
    diagnostics(
      {
        error,
        contract,
        quoteId,
        actionCode,
        runtimeVersion,
        blockNumber,
        transactionHash,
        version: "0.1.0-product-upgrade",
      },
      include,
    ),
    null,
    2,
  );
  return (
    <details>
      <summary>Export troubleshooting information</summary>
      <p>
        Preview the file below. Raw error text, wallet data, terms and signed
        requests are excluded. Nothing is uploaded.
      </p>
      <label>
        <input
          type="checkbox"
          checked={include}
          onChange={(e) => setInclude(e.target.checked)}
        />
        Include public contract and agreement IDs
      </label>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {output}
      </pre>
      <button
        className="native-secondary"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([output], { type: "application/json" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "pactpay-diagnostics.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        Download diagnostics
      </button>
    </details>
  );
}
