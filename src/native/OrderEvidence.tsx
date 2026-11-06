import { useEffect, useRef, useState } from "react";
import {
  keccak256,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { recoverTermsPackage, packageFromNativeTerms } from "./terms";
import { serializeNativePackage } from "./packages";
import {
  historyCoverage,
  scanHistoryBatch,
  type HistoryProgress,
} from "./history";
import abi from "../lib/pact-abi.json";
import type { NativeDeployment } from "./portability";
import type { NativeQuotePackage } from "./packages";
import { nativeReadClient as client } from "./read-client";
import {nativeHistoryPage} from './native-event-reader';
import {paymentStatus,paymentLabels} from './payment-status';
import {claimKindFromEvents} from './payment-snapshot';
import PaymentTimeline from './PaymentTimeline';
const stringify = (x: unknown) =>
  JSON.stringify(x, (_, v) => (typeof v === "bigint" ? String(v) : v), 2);
const names = [
  "Unknown",
  "Funding",
  "Ready",
  "Captured",
  "Cancelled",
  "Expired",
];
export default function OrderEvidence({
  config,
  account,
  quote,
  onSelect,
  onRecover,
  receiptOnly = false,
  onEvidence,
}: {
  config: NativeDeployment;
  account?: Address;
  quote?: NativeQuotePackage | null;
  onSelect?: (id: string) => void;
  onRecover?: (raw: string) => Promise<void>;
  receiptOnly?: boolean;
  onEvidence?: (value:any|null)=>void;
}) {
  const [from, setFrom] = useState(config.blockNumber),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<any[]>([]),
    [receipt, setReceipt] = useState<any>(null);
  const epoch = useRef(0);
  const [historySource,setHistorySource]=useState<'evm'|'native'>('evm');
  const [lookup,setLookup]=useState('');
  const receiptRef = useRef<any>(null);
  const saveReceipt = (value: any) => {
    receiptRef.current = value;
    setReceipt(value);
    onEvidence?.(value);
  };
  useEffect(() => {
    epoch.current++;
    setRows([]);
    setBusy(false);
    saveReceipt(null);
    setMessage("");
    setFrom(config.blockNumber);
    return () => {
      epoch.current++;
    };
  }, [config.contract, config.token, config.codeHash, config.tokenCodeHash, config.blockNumber, account, quote?.id,historySource]);
  async function verify() {
    if ((await client.getChainId()) !== 420420777) throw Error("Wrong chain");
    const code = await client.getCode({ address: config.contract });
    if (!code || keccak256(code) !== config.codeHash)
      throw Error("Deployment code mismatch");
    const tokenCode = await client.getCode({ address: config.token });
    if (!tokenCode || keccak256(tokenCode) !== config.tokenCodeHash)
      throw Error("Token code mismatch");
    const token = await client.readContract({
      address: config.contract,
      abi,
      functionName: "token",
    });
    if (String(token).toLowerCase() !== config.token.toLowerCase())
      throw Error("Payment token mismatch");
    return client.getBlock({ blockTag: "finalized" });
  }
  async function execute(fn: (e: number) => Promise<void>) {
    const e = ++epoch.current;
    setBusy(true);
    setMessage("");
    try {
      await fn(e);
    } catch (x) {
      if (e === epoch.current) setMessage((x as Error).message);
    } finally {
      if (e === epoch.current) setBusy(false);
    }
  }
  async function scan() {
    await execute(async (e) => {
      const searchAccount=lookup.trim()||account;
      if (!searchAccount||!/^0x[0-9a-f]{40}$/i.test(searchAccount)) throw Error("Enter a public H160 address or connect a mapped wallet first");
      if (!/^\d{1,20}$/.test(from)) throw Error("Enter a valid start block");
      const block = await verify(),
        start = BigInt(from);
      if (start > block.number) throw Error("Start is after finalized head");
      const end = start + 1999n < block.number ? start + 1999n : block.number;
      const found: any[] = [];
      let examined = 0;
      for (let cursor = start; cursor <= end; cursor += 250n) {
        const to = cursor + 249n < end ? cursor + 249n : end;
        const logs = historySource==='native'?(await nativeHistoryPage(cursor,to,config.contract,{number:block.number,hash:block.hash},()=>e!==epoch.current)).filter(event=>event.event==='QuoteCreated').map(event=>({...event,args:event.args})):await client.getContractEvents({
          address: config.contract,
          abi,
          eventName: "QuoteCreated",
          fromBlock: cursor,
          toBlock: to,
        });
        for (const log of logs) {
          if (++examined > 100)
            throw Error("More than 100 orders in this range; narrow the range");
          const id = (log as any).args.quoteId as Hex;
          const [q, state, held, members] = (await client.readContract({
            address: config.contract,
            abi,
            functionName: "getQuote",
            args: [id],
            blockNumber: block.number,
          })) as any;
          if (
            q.merchant.toLowerCase() === searchAccount.toLowerCase() ||
            members.some(
              (m: string) => m.toLowerCase() === searchAccount.toLowerCase(),
            )
          )
            found.push({
              id,
              state: Number(state),
              total: q.total,
              held,
              merchant: q.merchant,
              block: log.blockNumber,
            });
        }
        if (e !== epoch.current) return;
      }
      if (e !== epoch.current) return;
      setRows((previous) => [
        ...new Map(
          [...previous, ...found].map((row) => [row.id, row]),
        ).values(),
      ]);
      setMessage(
        `Scanned finalized blocks ${start}–${end}. ${end < block.number ? "More history remains; continue from " + (end + 1n) + "." : "Reached finalized head."} Found ${found.length} related orders. Terms text is not stored on chain; import the original agreement file to pay.`,
      );
      setFrom(String(end + 1n));
    });
  }
  async function inspect() {
    saveReceipt(null);
    await execute(async (e) => {
      if (!quote) throw Error("Select an agreement");
      const block = await verify();
      const [q, state, held, members] = (await client.readContract({
        address: config.contract,
        abi,
        functionName: "getQuote",
        args: [quote.id],
        blockNumber: block.number,
      })) as any;
      const digest = await client.readContract({
        address: config.contract,
        abi,
        functionName: "quoteDigest",
        args: [q],
        blockNumber: block.number,
      });
      if (Number(state) === 0 || digest !== quote.id)
        throw Error("Agreement not found or digest mismatch");
      const detail = await Promise.all(
        members.map(async (address: Address) => ({
          address,
          share: await client.readContract({
            address: config.contract,
            abi,
            functionName: "shares",
            args: [quote.id, address],
            blockNumber: block.number,
          }),
          contributed: await client.readContract({
            address: config.contract,
            abi,
            functionName: "contributions",
            args: [quote.id, address],
            blockNumber: block.number,
          }),
          claimable: await client.readContract({
            address: config.contract,
            abi,
            functionName: "credits",
            args: [quote.id, address],
            blockNumber: block.number,
          }),
        })),
      );
      const merchantCredit=await client.readContract({address:config.contract,abi,functionName:'credits',args:[quote.id,q.merchant],blockNumber:block.number});
      if (e !== epoch.current) return;
      const history: HistoryProgress = {
        fromBlock: BigInt(config.blockNumber),
        targetBlock: block.number,
        targetHash: block.hash,
        nextBlock: BigInt(config.blockNumber),
        events: [],
      };
      if (history.fromBlock > history.targetBlock)
        throw Error("Deployment start is after finalized head");
      const snapshot = {
        schema: "pactpay-order-snapshot-v1",
        chainId: 420420777,
        contract: config.contract,
        id: quote.id,
        finalizedBlock: block.number,
        blockHash: block.hash,
        chainTimestamp: block.timestamp,
        state: names[Number(state)],
        total: q.total,
        merchant:q.merchant,
        merchantCredit,
        historySource,
        held,
        members: detail,
        events: [],
        history,
        historyCoverage: historyCoverage(history, quote.id),
        scope:
          "Finalized state snapshot. Event history is partial until the pinned target is reached and the order creation receipt is verified. Capture is credit; claim transfers tokens. This does not prove delivery.",
      };
      saveReceipt(snapshot);
      await continueHistory(snapshot, e);
    });
  }
  async function continueHistory(snapshot: any, e: number) {
    const target = await client.getBlock({
      blockNumber: snapshot.history.targetBlock,
    });
    if (target.hash !== snapshot.history.targetHash)
      throw Error(
        "Pinned finalized block changed; restart snapshot verification",
      );
    const publish = (history: HistoryProgress) => {
      if (e !== epoch.current) return;
      saveReceipt({
        ...snapshot,
        events: history.events,
        history,
        historyCoverage: historyCoverage(history, snapshot.id),
      });
    };
    await scanHistoryBatch(
      snapshot.history,
      async (fromBlock, toBlock) => {
        if(snapshot.historySource==='native')return (await nativeHistoryPage(fromBlock,toBlock,config.contract,{number:snapshot.history.targetBlock,hash:snapshot.history.targetHash},()=>e!==epoch.current)).filter(event=>String(event.args.quoteId).toLowerCase()===snapshot.id.toLowerCase());
        const logs = await client.getContractEvents({
          address: config.contract,
          abi,
          fromBlock,
          toBlock,
        });
        const events = [];
        for (const raw of logs) {
          const log = raw as any;
          if (
            String(log.args?.quoteId).toLowerCase() !==
            snapshot.id.toLowerCase()
          )
            continue;
          if (log.removed || log.blockNumber < fromBlock || log.blockNumber > toBlock) throw Error("Event outside verified history page");
        const tx = await client.getTransactionReceipt({
            hash: log.transactionHash,
          });
          const included = tx.logs.some(
            (item) =>
              item.logIndex === log.logIndex &&
              item.address.toLowerCase() === config.contract.toLowerCase() &&
              item.blockHash === log.blockHash &&
              item.data === log.data &&
              JSON.stringify(item.topics) === JSON.stringify(log.topics),
          );
          if (
            tx.status !== "success" ||
            tx.blockHash !== log.blockHash ||
            tx.blockNumber !== log.blockNumber ||
            !included
          )
            throw Error("Event receipt mismatch");
          events.push({
            event: log.eventName,
            args: log.args,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            logIndex: log.logIndex,
            receiptStatus: tx.status,
          });
        }
        return events;
      },
      publish,
      () => e !== epoch.current,
      snapshot.historySource==='native'?2:8,
      snapshot.historySource==='native'?16n:250n,
    );
  }
  async function resumeHistory() {
    const snapshot = receiptRef.current;
    if (!snapshot) return;
    await execute(async (e) => {
      try {
        await verify();
        await continueHistory(snapshot, e);
      } catch (error) {
        if (e === epoch.current) {
          const history = {
            ...receiptRef.current.history,
            error: (error as Error).message,
          };
          saveReceipt({
            ...receiptRef.current,
            history,
            historyCoverage: historyCoverage(history, snapshot.id),
          });
        }
        throw error;
      }
    });
  }
  function download() {
    if (!receipt) return;
    const url = URL.createObjectURL(
      new Blob([stringify(receipt)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "pactpay-order-snapshot.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="native-panel">
      {!receiptOnly && <>
      <h2>Find orders and verify balances</h2>
      <p>
        Recover related orders from this deployment in batches of up to 2,000
        finalized blocks. Related orders accumulate as you continue. No
        transaction is sent.
      </p>
      <label>
        Start block
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          inputMode="numeric"
          disabled={busy}
        />
      </label>
      <label>Public address to find (optional H160)<input value={lookup} onChange={e=>{setLookup(e.target.value);setRows([]);}} disabled={busy} placeholder="0x… or use connected wallet"/></label>
      <button disabled={busy || (!account&&!lookup)} onClick={() => void scan()}>
        Find wallet orders
      </button>
      {rows.map((r) => (
        <article key={r.id}>
          <code>{r.id}</code>
          <p>
            {names[r.state]} · {formatUnits(r.total, 6)} dUSD · held{" "}
            {formatUnits(r.held, 6)} dUSD
          </p>
          <button onClick={() => onSelect?.(r.id)}>Open saved agreement</button>
          {onRecover && (
            <button
              disabled={busy}
              onClick={() =>
                void execute(async (e) => {
                  const target=await verify();
                  const nativeTerms=historySource==='native'?(await nativeHistoryPage(r.block,r.block,config.contract,{number:target.number,hash:target.hash},()=>e!==epoch.current)).filter(event=>event.event==='TermsPublished'&&String(event.args.quoteId).toLowerCase()===r.id.toLowerCase()):[];
                  if(historySource==='native'&&nativeTerms.length!==1)throw Error('Native original terms unavailable or ambiguous');
                  const recovered = historySource==='native'?await packageFromNativeTerms(client,config,r.id,nativeTerms[0].args.terms,target.number):await recoverTermsPackage(
                    client,
                    config,
                    r.id,
                    { fromBlock: r.block, toBlock: r.block },
                  );
                  if (e !== epoch.current) return;
                  await onRecover(serializeNativePackage(recovered));
                  if (e === epoch.current)
                    setMessage(
                      "Published terms recovered and verified. Open the agreement to review checkout.",
                    );
                })
              }
            >
              Recover published terms
            </button>
          )}
          <p>
            If no saved agreement opens, import its original terms file.
            Recovered IDs alone cannot reconstruct the agreed description.
          </p>
        </article>
      ))}
      <hr />
      </>}
      <button disabled={busy || !quote} onClick={() => void inspect()}>
        Verify selected order snapshot
      </button>
      <label>Evidence history source<select disabled={busy} value={historySource} onChange={e=>setHistorySource(e.target.value as 'evm'|'native')}><option value="evm">EVM RPC receipts</option><option value="native">Native V3 finalized events (slower)</option></select></label>
      <p>EVM RPC can omit native calls. Switch to native history when expected events are missing. Native history requires matching finalized block hashes and archive access.</p>
      {busy && (
        <button
          onClick={() => {
            epoch.current++;
            setBusy(false);
            setMessage(
              "Stopped. Completed history pages are retained; unverified pages remain partial.",
            );
          }}
        >
          Cancel reading
        </button>
      )}
      {receipt && (
        <>
          <PaymentTimeline snapshot={receipt}/>
          <section aria-label="Payment evidence summary">
            <h3>Money at the verified block</h3>
            <p>{paymentLabels[paymentStatus(names.indexOf(receipt.state),BigInt(receipt.merchantCredit??0),claimKindFromEvents(receipt.events,names.indexOf(receipt.state),receipt.id,receipt.merchant,receipt.merchant,BigInt(receipt.total)),true,true)]}</p>
            <p>Contract state: {receipt.state} · Held in escrow: {formatUnits(BigInt(receipt.held), 6)} dUSD</p>
            <p>State and amounts below refer to finalized block {String(receipt.finalizedBlock)}. History coverage is shown separately.</p>
            {receipt.members.map((member: any) => <p key={member.address}><code>{member.address}</code>: contributed {formatUnits(BigInt(member.contributed),6)} dUSD · claimable {formatUnits(BigInt(member.claimable),6)} dUSD</p>)}
            <h4>Verified claim events in the scanned range</h4>
            {receipt.events.filter((event: any) => event.event === "Claimed").length === 0 && <p>No claim event verified in this range. Zero claimable credit does not prove payment or refund completion.</p>}
            {receipt.events.filter((event: any) => event.event === "Claimed").map((event: any) => <article key={`${event.transactionHash}:${event.logIndex}`}><p>Transferred {formatUnits(BigInt(event.args.amount),6)} dUSD to <code>{event.args.recipient}</code></p><p>Transaction <code>{event.transactionHash}</code> · block {String(event.blockNumber)}</p></article>)}
          </section>
          <p role="status">
            {receipt.historyCoverage.status === "complete"
              ? "Complete order history: creation receipt verified through pinned finalized target."
              : `Partial history: verified through ${receipt.historyCoverage.toBlock ?? "no blocks yet"}; target ${receipt.historyCoverage.targetBlock}. ${receipt.historyCoverage.reachedTarget ? "Creation event was not found; configured start cannot establish complete history." : "Continue reading to include remaining blocks."}`}
          </p>
          {receipt.historyCoverage.nextBlock !== null && (
            <button disabled={busy} onClick={() => void resumeHistory()}>
              Continue order history
            </button>
          )}
          <details><summary>Technical snapshot JSON</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {stringify(receipt)}
          </pre></details>
          <button disabled={busy} onClick={download}>
            {receipt.historyCoverage.status === "complete"
              ? "Download verified snapshot"
              : "Download partial snapshot"}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Reading finalized chain data…</p>}
    </section>
  );
}
