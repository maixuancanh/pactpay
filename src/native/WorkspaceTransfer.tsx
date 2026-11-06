import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { serializeNativePackage, type NativeQuotePackage } from "./packages";
import {
  createTransferBundle,
  parseTransferBundle,
  createShareLink,
  parseShareFragment,
  MAX_TRANSFER_BYTES,
  type NativeDeployment,
  type NativeTransferBundle,
} from "./portability";
import "./workspace-transfer.css";
import { receiptLink } from "./receipt-package";
import RecoveryGuide from "./RecoveryGuide";

type Props = {
  config: NativeDeployment | null;
  quote: NativeQuotePackage | null;
  packages: string[];
  blocked: boolean;
  onImport: (bundle: NativeTransferBundle) => Promise<void>;
};
const exportFile = (value: NativeTransferBundle, name: string) => {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function WorkspaceTransfer({
  config,
  quote,
  packages,
  blocked,
  onImport,
}: Props) {
  const [raw, setRaw] = useState(""),
    [preview, setPreview] = useState<NativeTransferBundle | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState("");
  const previewRevision = useRef(0);
  const [invalidSource, setInvalidSource] = useState<"file" | "json" | null>(
    null,
  );
  useEffect(() => {
    try {
      const shared = parseShareFragment(location.hash);
      if (shared) {
        setPreview(shared);
        setMessage(
          "A shared agreement is ready to review. Nothing has been imported or signed.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    setLink("");
  }, [quote?.id, config?.contract]);
  const isBlocked = blocked || busy;
  function attempt(fn: () => void, source?: "json") {
    setError("");
    setInvalidSource(null);
    setMessage("");
    try {
      fn();
    } catch (e) {
      setError((e as Error).message);
      if (source) setInvalidSource(source);
    }
  }
  function bundle(kind: "agreement" | "workspace") {
    if (!config) throw Error("Set up or import a verified deployment first.");
    return createTransferBundle(
      kind,
      config,
      kind === "agreement"
        ? quote
          ? [serializeNativePackage(quote)]
          : []
        : packages,
    );
  }
  async function copyLink() {
    setError("");
    setMessage("");
    try {
      const next = createShareLink(
        location.origin + "/native",
        bundle("agreement"),
      );
      setLink(next);
      try {
        await navigator.clipboard.writeText(next);
        setMessage(
          "Agreement link copied. Anyone with the link can read its terms.",
        );
      } catch {
        setMessage(
          "Copy the link from the field below. Anyone with it can read its terms.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function showPreview(value: string) {
    const parsed = parseTransferBundle(value);
    previewRevision.current++;
    setPreview(parsed);
    setMessage(
      "Review this file, then verify its contracts and agreements on-chain before importing.",
    );
  }
  async function importPreview() {
    if (!preview || isBlocked) return;
    const expected = previewRevision.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onImport(preview);
      if (expected === previewRevision.current) {
        setPreview(null);
        setRaw("");
        setMessage(
          "Verified workspace data imported. No transaction was sent.",
        );
        if (location.hash.startsWith("#pactpay="))
          history.replaceState(null, "", location.pathname + location.search);
      }
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="native-panel native-transfer"
      aria-labelledby="native-transfer-title"
      aria-busy={busy}
    >
      <div className="native-paneltitle">
        <h2 id="native-transfer-title">Share and restore</h2>
      </div>
      <RecoveryGuide />
      <p>
        Share an agreement with its deployment, or keep a workspace backup.
        Opening a link only shows a preview. Importing checks on-chain code and
        agreement contents before saving.
      </p>
      <div className="native-transfer-actions">
        <button className="native-secondary" disabled={isBlocked || !config || !quote} onClick={() => void attempt(async () => {const url = receiptLink(location.href, bundle("agreement")); await navigator.clipboard.writeText(url); setMessage("Read-only receipt link copied. It contains public agreement terms.");})}>Copy read-only receipt link</button>
        <button
          aria-describedby="native-transfer-export-help"
          className="native-secondary"
          disabled={isBlocked || !config || !quote}
          onClick={() => void copyLink()}
        >
          Copy agreement link
        </button>
        <button
          aria-describedby="native-transfer-export-help"
          className="native-secondary"
          disabled={isBlocked || !config || !quote}
          onClick={() =>
            attempt(() =>
              exportFile(bundle("agreement"), "pactpay-agreement.json"),
            )
          }
        >
          Download agreement file
        </button>
        <button
          aria-describedby="native-transfer-export-help"
          className="native-secondary"
          disabled={isBlocked || !config}
          onClick={() =>
            attempt(() =>
              exportFile(bundle("workspace"), "pactpay-workspace-backup.json"),
            )
          }
        >
          Download workspace backup
        </button>
      </div>
      <p className="native-footnote" id="native-transfer-export-help">
        {!config
          ? "Set up or import a verified deployment to export a backup. Select a verified agreement to share it."
          : !quote
            ? "Select a verified agreement to copy its link or download its file."
            : "Exports contain public terms; share them only with intended recipients."}
        {blocked &&
          " Finish the current review or reconcile the pending request before transferring workspace data."}
      </p>
      <p className="native-footnote">
        Links contain public agreement terms in the URL fragment. The fragment
        is not uploaded by PactPay, but anyone you share the link with can read
        it. Backups contain deployment and agreement data only; no keys, signed
        transactions or pending requests.
      </p>
      {link && (
        <label>
          Agreement link
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
        </label>
      )}
      <details open={!!preview || undefined}>
        <summary>Import a shared agreement or backup</summary>
        <label>
          Choose a PactPay file
          <input
            type="file"
            accept="application/json,.json"
            disabled={isBlocked}
            aria-invalid={invalidSource === "file" || undefined}
            aria-describedby={`native-transfer-input-help${invalidSource === "file" ? " native-transfer-error" : ""}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError("");
              setInvalidSource(null);
              setMessage("");
              if (file.size > MAX_TRANSFER_BYTES) {
                setError("Workspace file is too large.");
                setInvalidSource("file");
                e.target.value = "";
                return;
              }
              void file
                .text()
                .then((value) => {
                  try {
                    showPreview(value);
                  } catch (error) {
                    setError((error as Error).message);
                    setInvalidSource("file");
                  }
                })
                .catch((error) => {
                  setError(String(error));
                  setInvalidSource("file");
                });
              e.target.value = "";
            }}
          />
        </label>
        <label>
          Transfer JSON
          <textarea
            aria-label="Transfer JSON"
            rows={5}
            value={raw}
            disabled={isBlocked}
            aria-invalid={invalidSource === "json" || undefined}
            aria-describedby={`native-transfer-input-help${invalidSource === "json" ? " native-transfer-error" : ""}`}
            onChange={(e) => {
              previewRevision.current++;
              setRaw(e.target.value);
              setError("");
              setInvalidSource(null);
              setPreview(null);
            }}
          />
        </label>
        <p id="native-transfer-input-help" className="native-footnote">
          Choose a PactPay JSON file up to 1 MB, or paste its contents. Enter
          JSON to enable Preview import. Previewing saves nothing and requests
          no signature.
        </p>
        <button
          aria-describedby="native-transfer-input-help"
          className="native-secondary"
          disabled={isBlocked || !raw}
          onClick={() => attempt(() => showPreview(raw), "json")}
        >
          Preview import
        </button>
      </details>
      {preview && (
        <section className="native-transfer-preview" aria-label="Review import">
          <h3>Review import</h3>
          <p>
            {preview.kind === "agreement"
              ? "Shared agreement"
              : "Workspace backup"}{" "}
            · {preview.agreements.length} agreement
            {preview.agreements.length === 1 ? "" : "s"}
          </p>
          <dl>
            <dt>Network</dt>
            <dd>Portaldot V3 Testnet · 420420777</dd>
            <dt>Escrow</dt>
            <dd>{preview.deployment.contract}</dd>
            <dt>Payment token</dt>
            <dd>{preview.deployment.token}</dd>
          </dl>
          {preview.agreements.length > 0 && (
            <ul>
              {preview.agreements.map((raw) => {
                const p = JSON.parse(raw);
                return (
                  <li key={p.id}>
                    <strong>{p.terms.title}</strong>
                    <span>
                      {formatUnits(BigInt(p.quote.total), 6)} dUSD ·{" "}
                      {p.members.length} member
                      {p.members.length === 1 ? "" : "s"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p>
            These files are untrusted until verification succeeds. Existing
            pending transactions stay untouched. A different deployment replaces
            the currently displayed workspace only after every imported
            agreement verifies.
          </p>
          <div className="native-transfer-actions">
            <button disabled={isBlocked} onClick={() => void importPreview()}>
              {busy ? "Verifying on-chain…" : "Verify and import"}
            </button>
            <button
              className="native-secondary"
              disabled={busy}
              onClick={() => {
                previewRevision.current++;
                setPreview(null);
              }}
            >
              Dismiss import preview
            </button>
          </div>
        </section>
      )}
      {error && (
        <p
          className="native-alert native-error"
          role="alert"
          id="native-transfer-error"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="native-alert native-success" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
