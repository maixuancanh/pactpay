import { useEffect, useState, useRef } from "react";
import { u8aToHex } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import {
  attendanceBytes,
  verifyAttendance,
  ATTENDANCE_GENESIS,
  type SignedAttendance,
  type AttendanceStatement,
} from "./attendance";
import type { NativeQuotePackage } from "./packages";
import { mergeAttendance } from "./attendance-registry";
export default function AttendancePanel({
  quote,
  account,
}: {
  quote: NativeQuotePackage;
  account?: string;
}) {
  const [raw, setRaw] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [value, setValue] = useState<SignedAttendance | null>(null);
  const [registry, setRegistry] = useState<SignedAttendance[]>([]);
  const registryRef = useRef<SignedAttendance[]>([]);
  const revision = useRef(0),
    context = useRef("");
  context.current = quote.id + ":" + (account || "");
  useEffect(() => {
    revision.current++;
    setRaw("");
    setMessage("");
    setValue(null);
    registryRef.current = [];
    setRegistry([]);
  }, [quote.id, account]);
  async function check(signed: SignedAttendance) {
    if(!signed||typeof signed!=='object'||Object.keys(signed).some(key=>!['statement','signature'].includes(key)))throw Error('Unexpected signed statement fields');
    await cryptoWaitReady();
    verifyAttendance(signed, {
      genesis: ATTENDANCE_GENESIS,
      contract: quote.contract,
      quoteId: quote.id,
      termsHash: quote.quote.termsHash,
      attendee: signed.statement.attendee,
    });
    const { createNativeAdapter } = await import("./adapter");
    const a = await createNativeAdapter();
    try {
      const member = await a.account(signed.statement.attendee);
      if (
        !member.mapped ||
        !quote.members.some(
          (m) => m.toLowerCase() === member.h160.toLowerCase(),
        )
      )
        throw Error("Signer is not a verified mapped member");
    } finally {
      await a.disconnect();
    }
  }
  async function execute(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setValue(null);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="native-panel">
      <h2>Attendance statement</h2>
      <p>
        An optional participant signature, separate from payment. It proves the
        wallet signed these words, not physical attendance or service quality.
        It never changes capture, payout or refund rights. The stated time is
        supplied by the signer.
      </p>
      {account && (
        <button
          disabled={busy}
          onClick={() =>
            void execute(async () => {
              const expectedContext = context.current,
                expectedRevision = revision.current;
              const nonce = u8aToHex(
                crypto.getRandomValues(new Uint8Array(16)),
              );
              const statement: AttendanceStatement = {
                version: 1,
                domain: "PactPay.Attendance",
                genesis: ATTENDANCE_GENESIS,
                contract: quote.contract,
                quoteId: quote.id,
                termsHash: quote.quote.termsHash,
                attendee: account,
                statement: "I confirm I attended this booking",
                issuedAt: new Date().toISOString(),
                nonce,
              };
              const { web3FromAddress, web3Accounts } = await import(
                "@polkadot/extension-dapp"
              );
              if (!(await web3Accounts()).some((a) => a.address === account))
                throw Error("Reconnect the participant wallet first");
              const ext = await web3FromAddress(account);
              if (!ext.signer.signRaw)
                throw Error("This wallet cannot sign attendance statements");
              const pending = { statement, signature: "0x" };
              await cryptoWaitReady();
              const { createNativeAdapter } = await import("./adapter");
              const a = await createNativeAdapter();
              try {
                const m = await a.account(account);
                if (
                  !m.mapped ||
                  !quote.members.some(
                    (x) => x.toLowerCase() === m.h160.toLowerCase(),
                  )
                )
                  throw Error("Select a participant wallet");
              } finally {
                await a.disconnect();
              }
              if (
                !window.confirm(
                  `Sign this off-chain statement?\n${statement.statement}\nBooking: ${quote.id}\nTerms: ${statement.termsHash}\nTime (self-declared): ${statement.issuedAt}\nNo transaction or payment. Share only with intended recipients.`,
                )
              )
                return;
              const signature = await ext.signer.signRaw({
                address: account,
                data: u8aToHex(attendanceBytes(statement)),
                type: "bytes",
              });
              pending.signature = signature.signature;
              await check(pending);
              if (
                expectedContext !== context.current ||
                expectedRevision !== revision.current
              )
                throw Error(
                  "Booking or wallet changed. Verify the statement again.",
                );
              const next = mergeAttendance(registryRef.current, [pending]);
              setValue(pending);
              registryRef.current = next;
              setRegistry(next);
              setRaw(JSON.stringify(pending, null, 2));
              setMessage(
                "Signature and mapped membership verified. No transaction sent.",
              );
            })
          }
        >
          Review and sign attendance statement
        </button>
      )}
      <label>
        Signed attendance JSON
        <textarea
          aria-label="Signed attendance JSON"
          value={raw}
          onChange={(e) => {
            revision.current++;
            setRaw(e.target.value);
            setValue(null);
            setMessage("");
          }}
        />
      </label>
      <button
        disabled={busy || !raw.trim()}
        onClick={() =>
          void execute(async () => {
            const expectedContext = context.current,
              expectedRevision = revision.current;
            if (raw.length > 1000000) throw Error("Statement file too large");
            const parsed = JSON.parse(raw);
            const incoming: SignedAttendance[] = Array.isArray(parsed)
              ? parsed
              : parsed.schema === "pactpay-attendance-bundle-v1"
                ? parsed.statements
                : [parsed];
            if (
              !Array.isArray(incoming) ||
              incoming.length < 1 ||
              incoming.length > 50
            )
              throw Error("Import 1–50 signed statements");
            for (const item of incoming) await check(item);
            if (
              expectedContext !== context.current ||
              expectedRevision !== revision.current
            )
              throw Error(
                "Statement changed during verification. Verify again.",
              );
            const next = mergeAttendance(registryRef.current, incoming),
              duplicates =
                registryRef.current.length + incoming.length - next.length;
            registryRef.current = next;
            setRegistry(next);
            setValue(incoming[incoming.length - 1]);
            setMessage(
              duplicates
                ? `Verified statements kept; ${duplicates} exact duplicate(s) ignored. Conflicting nonce reuse is rejected.`
                : "Signature and mapped booking membership verified. This does not prove actual attendance.",
            );
          })
        }
      >
        Verify attendance statement
      </button>
      {value && (
        <button
          disabled={busy}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(value, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "pactpay-attendance.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download signed attendance
        </button>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        {registry.length} verified statements kept in this page session.
        Import/export the bundle to retain nonce checks across devices; it is
        not a global nonce registry.
      </p>
      {registry.length > 0 && (
        <button
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob(
                [
                  JSON.stringify(
                    {
                      schema: "pactpay-attendance-bundle-v1",
                      statements: registry,
                    },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              ),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "pactpay-attendance-bundle.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download attendance bundle
        </button>
      )}
      {busy && <p role="status">Checking signature and native membership…</p>}
    </section>
  );
}
