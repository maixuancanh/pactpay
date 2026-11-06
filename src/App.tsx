import {ExternalWalletProfile} from './account/ExternalWalletProfile';
import { useEffect, useState, type FormEvent } from "react";

import {
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCheck,
  ShieldCheck,
  Link2,
  Plus,
  Download,
  Upload,
  ChevronDown,
  Clock3,
  Wallet,
  LayoutGrid,
  Store,
  FileText,
  ExternalLink,
  RefreshCw,
  Copy,
  LoaderCircle,
  AlertCircle,
  X,
  CircleDollarSign,
  Users,
  LockKeyhole,
} from "lucide-react";

import {
  encodeFunctionData,
  formatUnits,
  parseUnits,
  hashTypedData,
  type Address,
  type Hex,
  isAddress,
} from "viem";

import abi from "./lib/pact-abi.json";

import {
  publicClient,
  walletClient,
  tokenAbi,
  short,
  type Deployment,
} from "./lib/chain";

import {
  hashTerms,
  makeQuote,
  quoteTypedData,
  parsePackage,
  serializePackage,
  type QuotePackage,
  type Terms,
} from "./features/quotes/schema";

import {
  readPending,
  savePending,
  clearPending,
  requireSuccessfulReceipt,
  findIntentHash,
  explicitlyRejected,
} from "./lib/transactions";

import { useWalletConnection } from "./lib/useWalletConnection";
import { walletErrorMessage } from "./lib/wallet";
import {
  AccessibleDialog,
  CancelAgreementDialog,
} from "./components/AccessibleDialog";
import { MerchantInbox } from "./features/quotes/MerchantInbox";

type Member = {
  address: Address;
  share: bigint;
  contribution: bigint;
  credit: bigint;
  balance: bigint;
  allowance: bigint;
};

type Snapshot = {
  state: number;
  held: bigint;
  liability: bigint;
  merchantCredit: bigint;
  members: Member[];
  chainTime: number;
  balance: bigint;
  events: { label: string; hash: Hex }[];
};

const names = ["Alex", "Sam", "Jordan"];
const fmt = (v: bigint) => formatUnits(v, 6);
const date = (s: bigint) =>
  new Date(Number(s) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const statusNames = [
  "Not created",
  "Collecting",
  "Ready to capture",
  "Captured",
  "Cancelled",
  "Expired",
];

const labelFor = (state: number) =>
  state === 1
    ? "Collection open"
    : state === 2
      ? "Awaiting merchant"
      : state === 3
        ? "Payment captured"
        : state === 4
          ? "Cancelled · refunds available"
          : "Expired · refunds available";

export default function App() {
  const [profileOpen,setProfileOpen]=useState(false);
  const [dep, setDep] = useState<Deployment | null>(null),
    [pkg, setPkg] = useState<QuotePackage | null>(null),
    [snap, setSnap] = useState<Snapshot | null>(null),
    [view, setView] = useState("group"),
    [modal, setModal] = useState<"import" | "create" | null>(null),
    [raw, setRaw] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [rpcOk, setRpcOk] = useState(false),
    [pending, setPending] = useState(readPending()),
    [copy, setCopy] = useState(false),
    [cancelOpen, setCancelOpen] = useState(false),
    [loading, setLoading] = useState(true),
    [memberInputs, setMemberInputs] = useState<string[]>(["", "", ""]);

  const wallet = useWalletConnection(dep);
  const account = wallet.account;

  const [title, setTitle] = useState("A creative sprint, together"),
    [description, setDescription] = useState(
      "A shared remote design session for three makers. Delivery arranged directly with the merchant.",
    ),
    [merchantName, setMerchantName] = useState("Common Ground Studio"),
    [shareInputs, setShareInputs] = useState(["40", "35", "25"]);

  const client = dep ? publicClient(dep) : null;

  async function refresh(d = dep, p = pkg) {
    if (!d || !p) return;
    try {
      const c = publicClient(d);
      const chainId = await c.getChainId();
      if (chainId !== d.chainId)
        throw Error("Wrong chain. Check your RPC and deployment.");
      const onchain = (await c.readContract({
        address: d.contract,
        abi,
        functionName: "getQuote",
        args: [p.id],
      })) as any;

      if (onchain[1] === 0)
        throw Error(
          "Quote does not exist on this deployment. Re-run local setup or import the matching quote.",
        );
      if (onchain[0].termsHash !== hashTerms(p.terms))
        throw Error("On-chain terms do not match this package.");

      const members = await Promise.all(
        p.members.map(async (address, i) => {
          const [contribution, credit, balance, allowance] = await Promise.all([
            c.readContract({
              address: d.contract,
              abi,
              functionName: "contributions",
              args: [p.id, address],
            }),
            c.readContract({
              address: d.contract,
              abi,
              functionName: "credits",
              args: [p.id, address],
            }),
            c.readContract({
              address: d.token,
              abi: tokenAbi,
              functionName: "balanceOf",
              args: [address],
            }),
            c.readContract({
              address: d.token,
              abi: tokenAbi,
              functionName: "allowance",
              args: [address, d.contract],
            }),
          ]);
          return {
            address,
            share: p.shares[i],
            contribution: contribution as bigint,
            credit: credit as bigint,
            balance: balance as bigint,
            allowance: allowance as bigint,
          };
        }),
      );

      const [block, liability, merchantCredit, balance, logs] =
        await Promise.all([
          c.getBlock(),
          c.readContract({
            address: d.contract,
            abi,
            functionName: "totalLiability",
          }),
          c.readContract({
            address: d.contract,
            abi,
            functionName: "credits",
            args: [p.id, p.quote.merchant],
          }),
          c.readContract({
            address: d.token,
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [d.contract],
          }),
          c.getContractEvents({
            address: d.contract,
            abi,
            fromBlock: BigInt(d.blockNumber),
            toBlock: "latest",
          }),
        ]);

      const events = (logs as any[])
        .filter((x) => x.args?.quoteId === p.id)
        .slice(-5)
        .reverse()
        .map((x) => ({
          label:
            x.eventName === "Contributed"
              ? "Contribution confirmed"
              : x.eventName === "Claimed"
                ? "Funds claimed"
                : x.eventName === "Withdrawn"
                  ? "Contribution withdrawn"
                  : x.eventName === "QuoteCreated"
                    ? "Agreement created"
                    : statusNames[Number(x.args?.state)] || x.eventName,
          hash: x.transactionHash,
        }));
      setSnap({
        state: Number(onchain[1]),
        held: onchain[2],
        liability: liability as bigint,
        merchantCredit: merchantCredit as bigint,
        balance: balance as bigint,
        members,
        chainTime: Number(block.timestamp),
        events,
      });
      setRpcOk(true);
    } catch (e) {
      setRpcOk(false);
      setError(errorText(e));
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const override = localStorage.getItem("pactpay.deployment.override");
        const r = override ? null : await fetch("/deployment.json");
        if (r && !r.ok)
          throw Error(
            "Local deployment not found. Start the local chain and run npm run deploy:local.",
          );
        const bundled = r ? ((await r.json()) as Deployment) : null;
        const d = (override ? JSON.parse(override) : bundled) as Deployment;
        if (![31337, 420420777].includes(d.chainId))
          throw Error("Unsupported deployment chain.");
        setDep(d);
        setMemberInputs(
          d.mode === "local" && d.accounts.length >= 4
            ? d.accounts.slice(1, 4)
            : ["", "", ""],
        );
        if (override && !location.hash) {
          const cached = localStorage.getItem("pactpay.last-open-package");
          if (!cached) {
            setRpcOk(true);
            return;
          }
          try {
            const candidate = await parsePackage(cached);
            if (candidate.contract.toLowerCase() !== d.contract.toLowerCase()) {
              setRpcOk(true);
              return;
            }
          } catch {
            setRpcOk(true);
            return;
          }
        }
        let text: string;
        if (location.hash.startsWith("#quote=")) {
          text = new TextDecoder().decode(
            Uint8Array.from(atob(location.hash.slice(7)), (x) =>
              x.charCodeAt(0),
            ),
          );
        } else {
          text = await (await fetch("/sample-quote.json")).text();
        }
        const saved = localStorage.getItem("pactpay.last-open-package");
        if (!location.hash && saved) {
          try {
            const cached = await parsePackage(saved);
            if (
              cached.chainId === d.chainId &&
              cached.contract.toLowerCase() === d.contract.toLowerCase()
            )
              text = saved;
          } catch {}
        }
        const p = await parsePackage(text);
        if (
          p.chainId !== d.chainId ||
          p.contract.toLowerCase() !== d.contract.toLowerCase() ||
          p.quote.token.toLowerCase() !== d.token.toLowerCase()
        )
          throw Error(
            "Package belongs to a different deployment. Import its matching configuration.",
          );
        setPkg(p);
        await refresh(d, p);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!dep || !pkg) return;
    const timer = setInterval(() => {
      void refresh();
    }, 6000);
    return () => clearInterval(timer);
  }, [dep, pkg]);

  function errorText(e: unknown) {
    return walletErrorMessage(e);
  }
  async function connected() {
    if (!dep || !account) throw Error("Connect your wallet first.");
    await wallet.guard();
    return walletClient(dep, account, wallet.mode);
  }
  async function connect() {
    setError("");
    setNotice("");
    try {
      await wallet.connect();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function switchNetwork() {
    setError("");
    try {
      await wallet.switchNetwork();
    } catch (e) {
      setError(errorText(e));
    }
  }
  function openModal(value: "create" | "import") {
    setError("");
    setModal(value);
  }
  function trackedWriter(w: any, label: string, quoteId: string) {
    return new Proxy(w, {
      get(target, prop) {
        if (prop !== "writeContract") return target[prop];
        return async (request: any) => {
          if (!dep || !client || !account)
            throw Error("Connect an account first.");
          await wallet.guard();
          // Fail definite preflight errors before creating a blocking intent.
          await client.simulateContract({ ...request, account });
          const nonce = await client.getTransactionCount({
            address: account,
            blockTag: "pending",
          });
          const intent = {
            label,
            chainId: dep.chainId,
            contract: dep.contract,
            quoteId,
            from: account,
            nonce,
            to: request.address as Address,
            data: encodeFunctionData({
              abi: request.abi,
              functionName: request.functionName,
              args: request.args,
            }),
            value: String(request.value || 0n),
            startBlock: String(await client.getBlockNumber()),
            state: "awaiting-signature" as const,
          };
          savePending(intent);
          setPending(readPending());
          try {
            await wallet.guard();
            const hash = await target.writeContract({ ...request, nonce });
            savePending({ ...intent, hash, state: "submitted" });
            setPending(readPending());
            return hash;
          } catch (error) {
            if (explicitlyRejected(error)) {
              clearPending();
              setPending(null);
            } else {
              savePending({ ...intent, state: "unknown" });
              setPending(readPending());
            }
            throw error;
          }
        };
      },
    });
  }
  async function transact(label: string, fn: (w: any) => Promise<Hex>) {
    if (!dep || !pkg || !client || busy || pending) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const w = await connected();
      const hash = await fn(trackedWriter(w, label, pkg.id));
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 45000,
      });
      clearPending();
      setPending(null);
      await refresh();
      requireSuccessfulReceipt(receipt, label);
      setNotice(
        label +
          " confirmed on " +
          (dep.mode === "local" ? "the local chain." : "V3 testnet."),
      );
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function reconcile() {
    if (!pending || !client || !dep) return;
    if (
      pending.chainId !== dep.chainId ||
      pending.contract.toLowerCase() !== dep.contract.toLowerCase()
    ) {
      setError(
        "Pending transaction belongs to another deployment. Switch to its configuration before checking it.",
      );
      return;
    }
    setBusy("Checking receipt");
    try {
      const hash = await findIntentHash(client, pending);
      if (!hash)
        throw Error(
          "No exact matching transaction found in recent blocks. Check wallet activity; no payment was resent.",
        );
      const receipt = await client.getTransactionReceipt({ hash });
      clearPending();
      setPending(null);
      setNotice(
        receipt.status === "success"
          ? "Transaction confirmed. State refreshed."
          : "Transaction reverted. No successful payment was recorded.",
      );
      await refresh();
    } catch {
      setError(
        "Receipt is still unknown. Do not submit this payment again. Check the node or wallet before retrying.",
      );
    } finally {
      setBusy("");
    }
  }

  const member = snap?.members.find(
    (x) => x.address.toLowerCase() === account?.toLowerCase(),
  );
  const merchant = account?.toLowerCase() === pkg?.quote.merchant.toLowerCase();
  const credit = merchant ? snap?.merchantCredit || 0n : member?.credit || 0n;
  const state = snap?.state || 0;
  const now = snap?.chainTime || 0;
  const expired =
    !!pkg &&
    ((state === 1 && now >= Number(pkg.quote.fundingDeadline)) ||
      (state === 2 && now >= Number(pkg.quote.captureDeadline)));
  const disabled =
    !!busy ||
    !!pending ||
    !rpcOk ||
    !account ||
    wallet.wrongNetwork ||
    wallet.connecting;
  const paid = state === 3 && snap?.merchantCredit === 0n;
  const collected =
    snap?.members.reduce((a, m) => a + m.contribution, 0n) || 0n;
  const progress = pkg ? Number((collected * 100n) / pkg.quote.total) : 0;

  function call(fn: string, args: any[] = []) {
    return (w: any) =>
      w.writeContract({
        address: dep!.contract,
        abi,
        functionName: fn,
        args,
        gas: 1500000n,
      });
  }

  async function importQuote(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await parsePackage(raw);
      if (
        !dep ||
        p.contract.toLowerCase() !== dep.contract.toLowerCase() ||
        p.chainId !== dep.chainId ||
        p.quote.token.toLowerCase() !== dep.token.toLowerCase()
      )
        throw Error("This quote belongs to a different deployment.");
      setPkg(p);
      localStorage.setItem("pactpay.last-open-package", serializePackage(p));
      localStorage.setItem("pactpay.quote." + p.id, serializePackage(p));
      setModal(null);
      setRaw("");
      setError("");
      await refresh(dep, p);
    } catch (e) {
      setError(errorText(e));
    }
  }

  function download() {
    if (!pkg) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([serializePackage(pkg)], { type: "application/json" }),
    );
    a.download = "pactpay-" + pkg.id.slice(2, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function share() {
    if (!pkg) return;
    const bytes = new TextEncoder().encode(serializePackage(pkg));
    const encoded = btoa(String.fromCharCode(...bytes));
    await navigator.clipboard.writeText(
      location.origin + location.pathname + "#quote=" + encoded,
    );
    setCopy(true);
    setTimeout(() => setCopy(false), 2000);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!dep || !account || busy || pending) return;
    setBusy("Creating agreement");
    setError("");
    try {
      const w = await connected();
      const c = publicClient(dep);
      const t = (await c.getBlock()).timestamp;
      const terms: Terms = {
        title,
        description,
        merchantName,
        currency: "dUSD",
      };
      const members = memberInputs as Address[];
      if (
        members.some((x) => !isAddress(x)) ||
        new Set(members.map((x) => x.toLowerCase())).size !== members.length
      )
        throw Error("Enter different valid member wallet addresses.");
      if (members.length < 1 || members.length > 5)
        throw Error("Choose between one and five contributors.");
      const shares = shareInputs.map((x) => parseUnits(x, 6));
      if (shares.some((x) => x <= 0n))
        throw Error("Each share must be positive.");
      const q = makeQuote(
        account,
        dep.token,
        terms,
        members,
        shares,
        t + 86400n,
        t + 172800n,
        BigInt(Date.now()),
      );
      const typed = quoteTypedData(dep.chainId, dep.contract, q);
      const signature = await w.signTypedData(typed);
      const p: QuotePackage = {
        schemaVersion: 1,
        chainId: dep.chainId,
        contract: dep.contract,
        quote: q,
        terms,
        members,
        shares,
        signature,
        id: hashTypedData(typed),
      };
      await parsePackage(serializePackage(p));
      await wallet.guard();
      localStorage.setItem("pactpay.last-open-package", serializePackage(p));
      localStorage.setItem("pactpay.quote." + p.id, serializePackage(p));
      const hash = await trackedWriter(
        w,
        "Create agreement",
        p.id,
      ).writeContract({
        address: dep.contract,
        abi,
        functionName: "createQuote",
        args: [q, members, shares, signature],
        gas: 2000000n,
      });

      setPkg(p);
      localStorage.setItem("pactpay.last-open-package", serializePackage(p));
      localStorage.setItem("pactpay.quote." + p.id, serializePackage(p));
      const receipt = await c.waitForTransactionReceipt({
        hash,
        timeout: 45000,
      });
      clearPending();
      setPending(null);
      requireSuccessfulReceipt(receipt, "Agreement creation");
      setModal(null);
      setNotice(
        "Agreement created. Export or share the signed package with your group.",
      );
      await refresh(dep, p);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="app">
      <ExternalWalletProfile open={profileOpen} onClose={()=>setProfileOpen(false)} address={account??''} network={dep?'Chain '+dep.chainId:'Network not loaded'} mode="evm"/>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="PactPay home">
          <img className="pactpay-logo" src="/art/pactpay/pactpay-logo.webp" width="144" height="48" alt="PactPay" />
        </a>
        <a href="/setup" className="source-link">
          Deployment settings
        </a>
        <div className="workspace">
          <span className="workspace-avatar">CG</span>
          <span>
            Common Ground<small>Shared workspace</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          <button
            aria-label="Group checkout"
            aria-current={view === "group" ? "page" : undefined}
            className={view === "group" ? "selected" : ""}
            onClick={() => setView("group")}
          >
            <LayoutGrid size={18} />
            Group checkout<span className="nav-count">1</span>
          </button>
          <button
            aria-label="Merchant inbox"
            aria-current={view === "merchant" ? "page" : undefined}
            className={view === "merchant" ? "selected" : ""}
            onClick={() => setView("merchant")}
          >
            <Store size={18} />
            Merchant inbox
          </button>
          <button onClick={() => openModal("create")}>
            <Plus size={18} />
            New agreement
          </button>
          <button
            aria-label="Import agreement"
            onClick={() => openModal("import")}
          >
            <Upload size={18} />
            Import agreement
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="safe-card">
            <ShieldCheck size={22} />
            <strong>
              Your agreement.
              <br />
              Your money.
            </strong>
            <p>Funds follow the terms everyone agreed to.</p>
          </div>
          <div className="network">
            <span className={"dot " + (rpcOk ? "online" : "")} />
            <span>
              {dep?.mode === "local"
                ? "Local chain · 31337"
                : "Portaldot V3 testnet"}
              <small>
                {dep?.mode === "local"
                  ? "Real transactions, test funds"
                  : "Deployment required"}
              </small>
            </span>
          </div>
        </div>
      </aside>

      <div className="page">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            {view === "group" ? "Group checkout" : "Merchant inbox"}
          </div>
          <div className="account-area">{account&&<button className="native-workspace-link" onClick={()=>setProfileOpen(true)}>Profile</button>}
            <a href="/native" className="native-workspace-link">Polkadot.js wallet →</a>
            {wallet.mode === "demo" && dep?.mode === "local" ? (
              <>
                <span className="mode-pill">LOCAL DEMO</span>
                <label className="role-picker">
                  <Wallet size={15} />
                  <select
                    aria-label="Active local role"
                    value={account || ""}
                    onChange={(e) => {
                      wallet.setDemoAccount(e.target.value as Address);
                      setError("");
                      setNotice("");
                    }}
                  >
                    {dep.accounts.map((a, i) => (
                      <option key={a} value={a}>
                        {i === 0 ? "Merchant" : names[i - 1] || "Member"} ·{" "}
                        {short(a)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} />
                </label>
                <button
                  className="secondary wallet-connect"
                  onClick={connect}
                  disabled={wallet.connecting}
                >
                  {wallet.connecting ? "Connecting…" : "Use wallet"}
                </button>
              </>
            ) : (
              <>
                {account ? (
                  <>
                    <span className="wallet-account">
                      <Wallet size={15} />
                      <span>
                        {short(account)}
                        <small>
                          {wallet.wrongNetwork
                            ? "Wrong network"
                            : dep?.chainId === 31337
                              ? "Local chain"
                              : "Portaldot V3"}
                        </small>
                      </span>
                    </span>
                    <button
                      className="secondary disconnect"
                      onClick={() => {
                        wallet.disconnect();
                        setError("");
                        setNotice("");
                      }}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="wallet-button"
                    onClick={connect}
                    disabled={wallet.connecting}
                  >
                    <Wallet size={16} />
                    {wallet.connecting ? "Connecting…" : "Connect wallet"}
                  </button>
                )}
                {dep?.mode === "local" && dep.accounts.length > 0 && (
                  <button
                    className="demo-link"
                    onClick={() => {
                      wallet.enterDemo();
                      setError("");
                      setNotice("");
                    }}
                  >
                    Try local demo
                  </button>
                )}
              </>
            )}
          </div>
        </header>

        <main id="main" aria-busy={loading}>
          <div className="heading">
            <div>
              <div className="eyebrow">
                ONE AGREEMENT. EVERYONE ON THE SAME PAGE.
              </div>
              <h1>
                {view === "group"
                  ? "Good things happen together."
                  : "Your group orders, in one place."}
              </h1>
              <p>
                {view === "group"
                  ? "A shared purchase. Clear contributions. No awkward chasing."
                  : "Accept a fully funded order or let every contributor get their money back."}
              </p>
            </div>
            <button className="secondary" onClick={() => openModal("create")}>
              <Plus size={17} />
              New agreement
            </button>
          </div>

          {wallet.mode === "wallet" && !account && dep && (
            <section
              className="onboarding card"
              aria-labelledby="welcome-title"
            >
              <div className="onboarding-symbol">
                <Users size={22} />
              </div>
              <div>
                <h2 id="welcome-title">
                  One purchase. Everyone keeps control.
                </h2>
                <p>
                  Connect the wallet listed in this agreement to see your share
                  and next step. You can read the signed terms without
                  connecting.
                </p>
                <span>
                  {dep.mode === "local"
                    ? "This workspace is on a local test chain. Use local demo to explore without a wallet."
                    : "Testnet only. No real-value payments."}
                </span>
              </div>
              <button
                className="secondary"
                onClick={connect}
                disabled={wallet.connecting}
              >
                {wallet.connecting ? "Connecting…" : "Connect to participate"}
                <ArrowRight size={15} />
              </button>
            </section>
          )}
          {wallet.message && (
            <p className="connection-message" role="status">
              {wallet.message}
            </p>
          )}
          {wallet.wrongNetwork && (
            <div className="message network-warning" role="alert">
              <AlertCircle size={18} />
              <span>
                Your wallet is on another network. This agreement uses{" "}
                {dep?.chainId === 31337
                  ? "the local test chain (31337)"
                  : "Portaldot V3 testnet"}
                .
              </span>
              <button onClick={switchNetwork}>Switch network</button>
            </div>
          )}
          {busy && !pending && (
            <div className="message pending" role="status">
              <LoaderCircle size={17} />
              <span>
                Waiting for your wallet: {busy}. Review the request in your
                wallet before approving.
              </span>
            </div>
          )}
          {error && (
            <div className="message error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <Check size={18} />
              <span>{notice}</span>
            </div>
          )}
          {pending && (
            <div className="message pending" role="status">
              <Clock3 size={18} />
              <span>
                {pending.label}: receipt pending or unknown. Payment is blocked
                until reconciled.
              </span>
              <button onClick={reconcile} disabled={!!busy}>
                Check receipt
              </button>
              <button
                aria-label="Copy pending transaction hash"
                onClick={() =>
                  navigator.clipboard.writeText(
                    pending.hash ||
                      "No transaction hash returned; exact intent saved locally.",
                  )
                }
              >
                <Copy size={14} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="workspace-loading" role="status">
              <span />
              <span />
              <span />
              <p>Verifying the signed agreement and reading balances…</p>
            </div>
          ) : !pkg || !dep ? (
            <div className="empty">
              <ShieldCheck size={36} />
              <h2>
                {dep ? "Start your first agreement" : "Connect a deployment"}
              </h2>
              <p>
                Create or import a signed quote on your selected deployment. If
                you have no deployment, set it up with your browser wallet.
              </p>
              <a href="/setup" className="secondary">
                Set up or import deployment
              </a>
              {dep && (
                <>
                  <button
                    className="primary"
                    onClick={() => openModal("create")}
                  >
                    Create agreement
                  </button>
                  <button onClick={() => openModal("import")}>
                    Import signed agreement
                  </button>
                </>
              )}
              <button className="primary" onClick={() => location.reload()}>
                <RefreshCw size={16} />
                Refresh workspace
              </button>
            </div>
          ) : (
            <>
              {view === "merchant" && (
                <MerchantInbox
                  deployment={dep}
                  account={account}
                  mode={wallet.mode}
                  current={pkg}
                  onOpen={async (p) => {
                    setPkg(p);
                    localStorage.setItem(
                      "pactpay.last-open-package",
                      serializePackage(p),
                    );
                    await refresh(dep, p);
                  }}
                  onImport={() => openModal("import")}
                  onConnect={connect}
                  onDemoMerchant={() => wallet.setDemoAccount(dep.accounts[0])}
                  refreshKey={notice}
                />
              )}
              <div className="content-grid">
                <section className="agreement card">
                  <div className="agreement-top">
                    <span className="category">
                      <span className="mini-icon">
                        <Users size={15} />
                      </span>
                      GROUP PURCHASE
                    </span>
                    <span className={"status status-" + state}>
                      <span className="dot online" />
                      {paid ? "Paid to merchant" : labelFor(state)}
                    </span>
                  </div>
                  <div className="agreement-title">
                    <div className="studio-art">
                      <span className="art-ring one" />
                      <span className="art-ring two" />
                      <span className="art-dot" />
                    </div>
                    <div>
                      <h2>{pkg.terms.title}</h2>
                      <p>
                        Hosted by <strong>{pkg.terms.merchantName}</strong>
                        <ShieldCheck size={14} />
                      </p>
                    </div>
                  </div>
                  <p className="description">{pkg.terms.description}</p>
                  <div className="total-row">
                    <div>
                      <span className="field-label">TOTAL AGREED PRICE</span>
                      <div className="amount">
                        {fmt(pkg.quote.total)}
                        <span>dUSD</span>
                      </div>
                    </div>
                    <div className="avatars">
                      <span>A</span>
                      <span>S</span>
                      <span>Y</span>
                      <small>
                        {pkg.members.length}{" "}
                        {pkg.members.length === 1
                          ? "contributor"
                          : "contributors"}
                      </small>
                    </div>
                  </div>
                  <div className="progress-label">
                    <span>
                      {fmt(collected)} of {fmt(pkg.quote.total)} dUSD
                      contributed
                    </span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: progress + "%" }} />
                  </div>
                  <div className="terms-strip">
                    <div>
                      <Clock3 size={17} />
                      <span>
                        Collection closes
                        <strong>{date(pkg.quote.fundingDeadline)}</strong>
                      </span>
                    </div>
                    <div>
                      <Store size={17} />
                      <span>
                        Merchant accepts by
                        <strong>{date(pkg.quote.captureDeadline)}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="member-table">
                    <div className="table-head">
                      <span>CONTRIBUTOR</span>
                      <span>SHARE</span>
                      <span>STATUS</span>
                    </div>
                    {snap?.members.map((m, i) => (
                      <div className="member-row" key={m.address}>
                        <div className="person">
                          <span className={"avatar avatar-" + i}>
                            {names[i]?.[0] || "M"}
                          </span>
                          <span>
                            {m.address.toLowerCase() === account?.toLowerCase()
                              ? "You"
                              : names[i] || "Member"}
                            <small>{short(m.address)}</small>
                          </span>
                        </div>
                        <strong>
                          {fmt(m.share)} <small>dUSD</small>
                        </strong>
                        <span
                          className={
                            m.contribution > 0n
                              ? "member-status paid"
                              : "member-status"
                          }
                        >
                          {m.contribution > 0n ? (
                            <CheckCheck size={14} />
                          ) : (
                            <Clock3 size={14} />
                          )}{" "}
                          {m.contribution > 0n
                            ? "Contributed"
                            : m.credit > 0n
                              ? "Refund available"
                              : state >= 4
                                ? "Not collected"
                                : "Awaiting payment"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="verified-footer">
                    <ShieldCheck size={16} />
                    <span>Merchant signature verified · immutable terms</span>
                    <button onClick={download}>
                      <Download size={15} />
                      Export
                    </button>
                    <button onClick={share}>
                      <Link2 size={15} />
                      {copy ? "Copied" : "Share"}
                    </button>
                  </div>
                </section>

                <aside className="right-column">
                  <section className="action-card">
                    <span className="section-kicker">
                      {merchant
                        ? "MERCHANT ACTION"
                        : member
                          ? "YOUR CONTRIBUTION"
                          : "VIEWING AGREEMENT"}
                    </span>
                    <div className="action-heading">
                      <h2>
                        {!account
                          ? "Join with your wallet"
                          : paid
                            ? "Payment complete"
                            : credit > 0n
                              ? merchant
                                ? "Your payout is ready."
                                : "Your refund is ready."
                              : state === 4 || state === 5
                                ? "This order is closed."
                                : merchant
                                  ? state === 2
                                    ? "The group is ready."
                                    : "Waiting for the group."
                                  : state === 3
                                    ? "Merchant has captured."
                                    : member?.contribution
                                      ? "You’re all set."
                                      : member
                                        ? "Your share, your choice."
                                        : "You’re viewing this order."}
                      </h2>
                      <span className="action-icon">
                        {merchant ? <Store size={25} /> : <Wallet size={25} />}
                      </span>
                    </div>
                    <p>
                      {!account
                        ? "Connect the wallet named in this agreement. Your funds and permissions always stay with that account."
                        : paid
                          ? "The merchant’s payout was claimed. Funds are no longer in this agreement. Arrange delivery directly with the merchant."
                          : credit > 0n
                            ? merchant
                              ? "Capture is complete. Claim your payout to transfer the funds to your wallet."
                              : "Refunds are unlocked. Claim your own contribution; other members do not need to act first."
                            : state === 4 || state === 5
                              ? "Collection is closed. There is no remaining credit for this account. Contributions already claimed are back in their owners’ wallets."
                              : state === 3
                                ? "The order is captured. Funds are claimable by the merchant; they are no longer refundable under this collection agreement."
                                : merchant
                                  ? "Capture only after every share arrives, before the acceptance deadline. Capture creates credit; claiming transfers the money."
                                  : member?.contribution
                                    ? "Your contribution is held in the contract. Before the group is complete you may withdraw; once ready, funds stay locked until capture, cancellation or expiry."
                                    : member
                                      ? "Approve exactly your share, then contribute to these signed terms. Approval alone does not move money."
                                      : "This wallet is not a contributor or merchant on this agreement. You can read the terms, but cannot use another person’s permissions."}
                    </p>
                    {!account && (
                      <button
                        className="primary"
                        disabled={wallet.connecting}
                        onClick={connect}
                      >
                        Connect wallet to continue
                        <Wallet size={16} />
                      </button>
                    )}
                    {account && !merchant && !member && (
                      <div className="readonly-note">
                        <ShieldCheck size={15} />
                        Read-only for this wallet
                      </div>
                    )}
                    {wallet.wrongNetwork && (
                      <button className="outline-light" onClick={switchNetwork}>
                        Switch to agreement network
                      </button>
                    )}
                    {(merchant || member) && (
                      <div className="your-share">
                        <span>
                          {credit > 0n
                            ? "Available to claim"
                            : merchant
                              ? "Order total"
                              : "Your agreed share"}
                        </span>
                        <strong>
                          {fmt(
                            credit > 0n
                              ? credit
                              : merchant
                                ? pkg.quote.total
                                : member?.share || 0n,
                          )}{" "}
                          <small>dUSD</small>
                        </strong>
                      </div>
                    )}

                    {member &&
                      state === 1 &&
                      !expired &&
                      member.contribution === 0n && (
                        <>
                          <div className="steps-mini">
                            <span
                              className={
                                member.allowance >= member.share ? "done" : ""
                              }
                            >
                              <Check size={12} />
                              1. Approve token
                            </span>
                            <span>2. Contribute</span>
                          </div>
                          {member.allowance < member.share ? (
                            <button
                              className="primary"
                              disabled={disabled}
                              onClick={() =>
                                transact("Token approval", (w) =>
                                  w.writeContract({
                                    address: dep.token,
                                    abi: tokenAbi,
                                    functionName: "approve",
                                    args: [dep.contract, member.share],
                                  }),
                                )
                              }
                            >
                              {busy ? (
                                <LoaderCircle className="spin" size={17} />
                              ) : (
                                <LockKeyhole size={17} />
                              )}
                              Approve {fmt(member.share)} dUSD
                              <ArrowRight size={17} />
                            </button>
                          ) : (
                            <button
                              className="primary"
                              disabled={disabled}
                              onClick={() =>
                                transact(
                                  "Contribution",
                                  call("contribute", [
                                    pkg.id,
                                    pkg.quote.termsHash,
                                  ]),
                                )
                              }
                            >
                              {busy ? (
                                <LoaderCircle className="spin" size={17} />
                              ) : null}
                              Contribute {fmt(member.share)} dUSD
                              <ArrowRight size={17} />
                            </button>
                          )}
                          <span className="button-help">
                            Approval gives permission. Contribution moves your
                            funds.
                          </span>
                        </>
                      )}

                    {member &&
                      member.contribution > 0n &&
                      state === 1 &&
                      !expired && (
                        <button
                          className="outline-light"
                          disabled={disabled}
                          onClick={() =>
                            transact(
                              "Contribution withdrawal",
                              call("withdrawContribution", [pkg.id]),
                            )
                          }
                        >
                          Withdraw contribution
                        </button>
                      )}

                    {merchant && state === 2 && !expired && (
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() =>
                          transact(
                            "Merchant capture",
                            call("capture", [pkg.id]),
                          )
                        }
                      >
                        Accept & capture order
                        <ArrowRight size={17} />
                      </button>
                    )}

                    {credit > 0n && (
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() =>
                          transact(
                            merchant ? "Merchant payout" : "Refund claim",
                            call("claim", [pkg.id]),
                          )
                        }
                      >
                        Claim {fmt(credit)} dUSD
                        <ArrowRight size={17} />
                      </button>
                    )}

                    {expired && (
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() =>
                          transact(
                            "Expiry and refund credits",
                            call("expire", [pkg.id]),
                          )
                        }
                      >
                        Close & unlock refunds
                        <ArrowRight size={17} />
                      </button>
                    )}

                    {merchant && (state === 1 || state === 2) && (
                      <button
                        className="text-light"
                        disabled={disabled}
                        onClick={() => setCancelOpen(true)}
                      >
                        Cancel order & unlock refunds
                      </button>
                    )}

                    {!merchant && member?.contribution && state === 2 ? (
                      <div className="waiting">
                        <Clock3 size={16} />
                        Waiting for merchant acceptance
                      </div>
                    ) : null}

                    {member &&
                      member.allowance > 0n &&
                      (state >= 3 || member.contribution > 0n) && (
                        <button
                          className="text-light"
                          disabled={disabled}
                          onClick={() =>
                            transact("Token allowance revoked", (w) =>
                              w.writeContract({
                                address: dep.token,
                                abi: tokenAbi,
                                functionName: "approve",
                                args: [dep.contract, 0n],
                              }),
                            )
                          }
                        >
                          Revoke remaining token allowance
                        </button>
                      )}

                    {member && (
                      <div className="balance-note">
                        Wallet balance{" "}
                        <strong>{fmt(member.balance)} dUSD</strong>
                      </div>
                    )}
                  </section>
                  <section className="promise card">
                    <div>
                      <ShieldCheck size={20} />
                      <h3>Clear terms. Built in.</h3>
                    </div>
                    <ul>
                      <li>
                        <Check size={15} />
                        Only your agreed share can be collected.
                      </li>
                      <li>
                        <Check size={15} />
                        No full group? Claim your funds back.
                      </li>
                      <li>
                        <Check size={15} />
                        No merchant acceptance? Refunds unlock.
                      </li>
                    </ul>
                    <p>
                      Payment protection covers collection and capture. It does
                      not guarantee delivery after the merchant is paid.
                    </p>
                  </section>
                  <a
                    className="source-link"
                    href="https://github.com/ItsCogumellum/portaldot-v3-testnet-guide"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Built for Portaldot V3
                    <ArrowUpRight size={16} />
                  </a>
                </aside>
              </div>

              <div className="bottom-grid">
                <section className="card timeline">
                  <div className="panel-header">
                    <h3>How your money moves</h3>
                    <span>Every step, agreed upfront</span>
                  </div>
                  <div className="journey">
                    {[
                      ["Agree", "Same quote. Same terms."],
                      ["Contribute", "Each member pays their share."],
                      ["Merchant accepts", "Only after the group is ready."],
                      ["Paid or refunded", "You can verify every transfer."],
                    ].map(([h, p], i) => (
                      <div
                        className={
                          "journey-step " +
                          (state > i || (i === 3 && paid) ? "active" : "")
                        }
                        key={h}
                      >
                        <span>
                          {state > i || (i === 3 && paid) ? (
                            <Check size={15} />
                          ) : (
                            i + 1
                          )}
                        </span>
                        <h4>{h}</h4>
                        <p>{p}</p>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="card activity">
                  <div className="panel-header">
                    <h3>On-chain activity</h3>
                    <button
                      aria-label="Refresh on-chain activity"
                      onClick={() => refresh()}
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                  {snap?.events.slice(0, 3).map((e, i) => (
                    <div className="activity-row" key={e.hash + i}>
                      <span className="activity-icon">
                        <Check size={13} />
                      </span>
                      <div>
                        {e.label}
                        <small>{short(e.hash)}</small>
                      </div>
                      <button
                        aria-label={"Copy transaction " + e.hash}
                        onClick={() => navigator.clipboard.writeText(e.hash)}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  ))}
                </section>
              </div>
              <footer className="page-footer">
                <span>
                  <LockKeyhole size={13} />
                  Your funds follow the agreement, not a group admin.
                </span>
                <span>
                  Test asset · no real monetary value{" "}
                  <span className="footer-divider">|</span>{" "}
                  {dep.mode === "local" ? "Local EVM evidence" : "V3 testnet"}
                </span>
              </footer>
              <details className="technical">
                <summary>Verify this deployment</summary>
                <p>
                  Contract: {dep.contract}
                  <br />
                  Token: {dep.token}
                  <br />
                  Quote: {pkg.id}
                  <br />
                  Liability: {snap ? fmt(snap.liability) : "—"} dUSD · contract
                  balance: {snap ? fmt(snap.balance) : "—"} dUSD
                  <br />
                  V3 canary deployment: pending. Local success does not prove V3
                  compatibility.
                </p>
              </details>
            </>
          )}
        </main>
      </div>

      <AccessibleDialog
        open={!!modal}
        onClose={() => setModal(null)}
        title={
          modal === "import"
            ? "Bring your agreement."
            : "Start with clear terms."
        }
        description={
          modal === "import"
            ? "Import a signed quote package. Its terms, members, network and merchant signature are checked before you participate."
            : "Create a new quote as merchant. Existing funds stay with their original agreement."
        }
      >
        {error && (
          <div className="message error" role="alert" id="dialog-error">
            <AlertCircle size={17} />
            <span>{error}</span>
          </div>
        )}
        {pending && (
          <div className="message pending" role="status">
            Your transaction was submitted. Close this dialog to check its
            receipt; do not create it again.
          </div>
        )}
        {modal === "import" ? (
          <form onSubmit={importQuote}>
            <div className="eyebrow">SIGNED & PORTABLE</div>

            <p>
              Import the signed JSON package. We’ll verify its terms, members,
              network and merchant signature.
            </p>
            <label>
              Quote package
              <textarea
                autoFocus
                aria-invalid={!!error}
                aria-describedby={error ? "dialog-error" : undefined}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={9}
                placeholder="Paste signed quote JSON"
                required
              />
            </label>
            <label className="file-label">
              Or choose a JSON file
              <input
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setRaw(await f.text());
                }}
              />
            </label>
            <button className="primary" type="submit">
              Verify & open agreement
              <ShieldCheck size={17} />
            </button>
          </form>
        ) : (
          <form onSubmit={create}>
            <div className="eyebrow">A SHARED COMMITMENT</div>

            <p>
              One test asset, one to five fixed shares. This creates a new
              agreement; it never moves money from an old one.
            </p>
            <label>
              Agreement title
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label>
              Merchant name
              <input
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                maxLength={100}
                required
              />
            </label>
            <label>
              What’s included
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={4000}
                required
              />
            </label>
            <fieldset className="member-addresses">
              <legend>Who is contributing?</legend>
              <label>
                Number of contributors
                <select
                  aria-label="Number of contributors"
                  value={memberInputs.length}
                  onChange={(e) => {
                    const count = Number(e.target.value);
                    setMemberInputs(
                      Array.from(
                        { length: count },
                        (_, i) => memberInputs[i] || "",
                      ),
                    );
                    setShareInputs(
                      Array.from(
                        { length: count },
                        (_, i) => shareInputs[i] || "10",
                      ),
                    );
                  }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {memberInputs.map((address, i) => (
                <label key={i}>
                  Member {i + 1} wallet
                  <input
                    aria-describedby="member-address-help"
                    value={address}
                    onChange={(e) =>
                      setMemberInputs(
                        memberInputs.map((x, j) =>
                          i === j ? e.target.value : x,
                        ),
                      )
                    }
                    placeholder="0x…"
                    required
                    pattern="0x[0-9a-fA-F]{40}"
                  />
                </label>
              ))}
              <p id="member-address-help">
                Only the listed wallets can contribute. Confirm each address
                with its owner before signing.
              </p>
            </fieldset>
            <div className="share-fields">
              {shareInputs.map((v, i) => (
                <label key={i}>
                  Member {i + 1} · dUSD
                  <input
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    value={v}
                    onChange={(e) =>
                      setShareInputs(
                        shareInputs.map((x, j) =>
                          i === j ? e.target.value : x,
                        ),
                      )
                    }
                    required
                  />
                </label>
              ))}
            </div>
            <div className="form-note">
              <Clock3 size={16} />
              Collection: 24 hours. Merchant capture: 48 hours from creation.
              Contributions may be withdrawn while collection is incomplete.
            </div>
            {(!account || wallet.wrongNetwork) && (
              <p className="form-note">
                {!account
                  ? "Connect a wallet or choose a local demo role before creating an agreement."
                  : "Switch your wallet to the agreement network to sign."}
              </p>
            )}
            <button className="primary" type="submit" disabled={disabled}>
              {busy || "Sign & create agreement"}
              <ArrowRight size={17} />
            </button>
          </form>
        )}
      </AccessibleDialog>
      <CancelAgreementDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        amount={fmt(snap?.held || 0n)}
        onConfirm={() => {
          setCancelOpen(false);
          void transact("Merchant cancellation", call("cancel", [pkg!.id]));
        }}
      />
    </div>
  );
}
