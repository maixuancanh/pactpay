import { useEffect, useState } from "react";
import { Store, ArrowRight, RefreshCw, FileText, Wallet } from "lucide-react";
import { formatUnits, type Address, type Hex } from "viem";
import { publicClient, short, type Deployment } from "../../lib/chain";
import abi from "../../lib/pact-abi.json";
import { parsePackage, type QuotePackage } from "./schema";
type Order = {
  id: Hex;
  state: number;
  total: bigint;
  held: bigint;
  credit: bigint;
  deadline: bigint;
};
export function MerchantInbox({
  deployment,
  account,
  mode,
  current,
  onOpen,
  onImport,
  onConnect,
  onDemoMerchant,
  refreshKey,
}: {
  deployment: Deployment;
  account: Address | null;
  mode: "demo" | "wallet";
  current: QuotePackage;
  onOpen: (p: QuotePackage) => Promise<void>;
  onImport: () => void;
  onConnect: () => void;
  onDemoMerchant: () => void;
  refreshKey: string;
}) {
  const [orders, setOrders] = useState<Order[]>([]),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  async function load() {
    if (!account) {
      setOrders([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const c = publicClient(deployment);
      const logs = await c.getContractEvents({
        address: deployment.contract,
        abi,
        eventName: "QuoteCreated",
        fromBlock: BigInt(deployment.blockNumber),
        toBlock: "latest",
      });
      const mine = (logs as any[])
        .filter((x) => x.args.merchant.toLowerCase() === account.toLowerCase())
        .slice(-20)
        .reverse();
      const result = await Promise.all(
        mine.map(async (x) => {
          const q = (await c.readContract({
            address: deployment.contract,
            abi,
            functionName: "getQuote",
            args: [x.args.quoteId],
          })) as any;
          const credit = (await c.readContract({
            address: deployment.contract,
            abi,
            functionName: "credits",
            args: [x.args.quoteId, account],
          })) as bigint;
          return {
            id: x.args.quoteId,
            state: Number(q[1]),
            total: q[0].total,
            held: q[2],
            credit,
            deadline: q[0].captureDeadline,
          };
        }),
      );
      setOrders(result);
    } catch {
      setError(
        "We couldn’t load your orders. Your funds have not changed. Retry when the connection is available.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [deployment.contract, account, refreshKey]);
  async function open(order: Order) {
    if (order.id === current.id) {
      await onOpen(current);
      return;
    }
    const stored = localStorage.getItem("pactpay.quote." + order.id);
    if (!stored) {
      onImport();
      return;
    }
    try {
      const p = await parsePackage(stored);
      if (
        p.chainId !== deployment.chainId ||
        p.contract.toLowerCase() !== deployment.contract.toLowerCase() ||
        p.quote.token.toLowerCase() !== deployment.token.toLowerCase()
      )
        throw Error("Wrong deployment");
      await onOpen(p);
    } catch {
      setError(
        "The saved quote package could not be verified. Import the original signed package to open its full terms.",
      );
    }
  }
  const visible = orders.filter(
    (x) =>
      filter === "all" ||
      (filter === "ready" && x.state === 2) ||
      (filter === "open" && x.state === 1) ||
      (filter === "closed" && x.state >= 3),
  );
  return (
    <section className="card merchant-inbox" aria-labelledby="inbox-title">
      <div className="inbox-heading">
        <div>
          <div className="eyebrow">YOUR MERCHANT WORKSPACE</div>
          <h2 id="inbox-title">
            Orders for {account ? short(account) : "your wallet"}
          </h2>
          <p>
            See funded orders, claimable payouts and orders that closed. Only
            the signed merchant can capture.
          </p>
        </div>
        <button
          className="secondary"
          aria-label="Refresh merchant inbox"
          disabled={!account || loading}
          onClick={load}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {!account ? (
        <div className="inbox-empty">
          <Wallet size={24} />
          <h3>Connect your merchant wallet</h3>
          <p>Your inbox only shows orders signed by the connected account.</p>
          <button className="secondary" onClick={onConnect}>
            Connect merchant wallet
          </button>
        </div>
      ) : (
        <>
          <div
            className="inbox-filters"
            role="group"
            aria-label="Filter merchant orders"
          >
            {[
              ["all", "All orders"],
              ["open", "Collecting"],
              ["ready", "Ready to capture"],
              ["closed", "Closed"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {label}
                <span>
                  {
                    orders.filter(
                      (x) =>
                        value === "all" ||
                        (value === "open" && x.state === 1) ||
                        (value === "ready" && x.state === 2) ||
                        (value === "closed" && x.state >= 3),
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          {error && (
            <div role="alert" className="message error">
              {error}
            </div>
          )}
          {loading ? (
            <p className="inbox-loading" role="status">
              Reading your orders from the agreement contract…
            </p>
          ) : visible.length ? (
            <div className="inbox-orders">
              {visible.map((o) => (
                <article
                  key={o.id}
                  className={
                    "inbox-order " + (current.id === o.id ? "current" : "")
                  }
                >
                  <span className="inbox-order-icon">
                    <FileText size={18} />
                  </span>
                  <div>
                    <h3>
                      {o.id === current.id
                        ? current.terms.title
                        : "Agreement " + short(o.id)}
                    </h3>
                    <p>
                      {o.state === 1
                        ? "Collecting shares"
                        : o.state === 2
                          ? "Fully funded · capture before deadline"
                          : o.state === 3
                            ? o.credit > 0n
                              ? "Captured · payout ready"
                              : "Payout claimed"
                            : o.state === 4
                              ? "Cancelled · contributors claim refunds"
                              : "Expired · contributors claim refunds"}
                    </p>
                    <small>{short(o.id)}</small>
                  </div>
                  <strong>
                    {formatUnits(o.total, 6)} <small>dUSD</small>
                  </strong>
                  <button className="secondary" onClick={() => open(o)}>
                    {o.id === current.id
                      ? "View details"
                      : localStorage.getItem("pactpay.quote." + o.id)
                        ? "Open"
                        : "Import terms"}
                    <ArrowRight size={14} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="inbox-empty">
              <Store size={24} />
              <h3>
                {orders.length
                  ? "No orders in this view"
                  : "No orders for this wallet yet"}
              </h3>
              <p>
                {orders.length
                  ? "Choose another filter to view your other orders."
                  : "Create an agreement as merchant, or connect the wallet that signed an existing quote."}
              </p>
              {mode === "demo" &&
                deployment.mode === "local" &&
                account.toLowerCase() !==
                  deployment.accounts[0]?.toLowerCase() && (
                  <button className="secondary" onClick={onDemoMerchant}>
                    Use merchant demo role
                  </button>
                )}
            </div>
          )}
        </>
      )}
      <div className="inbox-footnote">
        Showing the latest 20 orders for this contract. Full terms require the
        signed quote package; chain records alone do not contain the service
        description.
      </div>
    </section>
  );
}
