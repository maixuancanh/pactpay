import {ExternalWalletProfile} from '../account/ExternalWalletProfile';
import { useEffect, useRef, useState } from "react";
import {
  encodeDeployData,
  encodeFunctionData,
  formatUnits,
  parseUnits,
  keccak256,
  parseAbi,
  isAddress,
  hashTypedData,
  type Address,
  type Hex,
} from "viem";
import {
  Wallet,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Users,
  RefreshCw,
  Download,
  Upload,
  Plus,
  X,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  createNativeAdapter,
  connectNativeWallet,
  pending,
  subscribeNativeAccounts,
  nativeHistory,
} from "./adapter";
import {
  accountPermissionChange,
  selectedAuthorityChanged,
  assertReviewAuthority,
} from "./account-state";
import pactAbi from "../lib/pact-abi.json";
import * as Dialog from "@radix-ui/react-dialog";
import {
  makeQuote,
  quoteTypedData,
  type Terms,
} from "../features/quotes/schema";
import {
  parseNativePackage,
  serializeNativePackage,
  type NativeQuotePackage,
} from "./packages";
import "./native.css";
import { loadDraft, parseDraft, emptyDraft, DRAFT_KEY } from "./draft";
import { agreementNotice, isSnapshotFresh } from "./live-state";
import WorkspaceTransfer from "./WorkspaceTransfer";
import OrderEvidence from "./OrderEvidence";
import { checkoutNext, deadlineCalendar, workshopPolicy } from "./checkout";
import type { NativeTransferBundle } from "./portability";
import { createTransferBundle } from "./portability";
import { canonicalTerms } from "./terms";
import { nativeReadClient as client } from "./read-client";
import { checkoutAction } from "./checkout-action";
import { ledgerRow, orderReference, type OrderRead } from "./merchant-ledger";
import MerchantDashboard from "./MerchantDashboard";
import DiagnosticsPanel from "./DiagnosticsPanel";
import { exactShare, previewRevision, deadlineText } from "./agreement-preview";
import CostSummary from "./CostSummary";
import { paymentStatus, paymentLabels } from "./payment-status";
import { claimKindFromEvents } from "./payment-snapshot";
import AttendancePanel from "./AttendancePanel";

const WANTED = "5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt";
const CONFIG = "pactpay.native.config.v1",
  PACKAGES = "pactpay.native.packages.v1",
  RECOVERY = "pactpay.native.ui.recovery";
const assetAbi = parseAbi([
  "function decimals() view returns(uint8)",
  "function owner() view returns(address)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function mint(address,uint256)",
]);
type Config = {
  chainId: 420420777;
  contract: Address;
  token: Address;
  codeHash: Hex;
  tokenCodeHash: Hex;
  blockNumber: string;
};
type Member = { address: string; amount: string };
type Snap = {
  state: number;
  held: bigint;
  total: bigint;
  share: bigint;
  contributed: bigint;
  credit: bigint;
  balance: bigint;
  allowance: bigint;
  owner: Address;
  now: bigint;
  members: { address: Address; contributed: bigint; credit: bigint }[];
};
const WORKSPACE = "pactpay.native.workspace:v1";
const workspaceSaved = () => saved(WORKSPACE, null);
const short = (s: string) =>
  s.length > 20 ? s.slice(0, 8) + "…" + s.slice(-6) : s;
const amount = (n: bigint) => formatUnits(n, 6);
const native = (n: bigint) => formatUnits(n, 14);
const json = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x), 2);
const saved = (key: string, fallback: any) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
};
const same = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const states = [
  "Not created",
  "Collecting",
  "Ready to capture",
  "Captured",
  "Cancelled",
  "Expired",
];
function download(data: string, name: string, type = "application/json") {
  const u = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

export default function NativeApp() {
  const adapter = useRef<any>(null),
    accountRef = useRef(""),
    authorityEpoch = useRef(0),
    accountSubscription = useRef<null | (() => void)>(null),
    refreshing = useRef(false),
    reviewTrigger = useRef<HTMLElement | null>(null),
    contextRef = useRef(""),
    workspaceRevision = useRef(0);
  const [draft] = useState(() => {
    const d = loadDraft(localStorage);
    return localStorage.getItem(DRAFT_KEY)
      ? d
      : { ...d, members: [{ address: WANTED, amount: "10" }] };
  });
  const [readAt, setReadAt] = useState(0),
    [readFailed, setReadFailed] = useState(false),
    [clock, setClock] = useState(Date.now());
  const [accounts, setAccounts] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [info, setInfo] = useState<any>(null),
    [identity, setIdentity] = useState<any>(null),
    [health, setHealth] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [history, setHistory] = useState<any[]>(() =>
    nativeHistory(localStorage),
  );
  const [config, setConfig] = useState<Config | null>(
      () => workspaceSaved()?.config || saved(CONFIG, null),
    ),
    [configRaw, setConfigRaw] = useState(""),
    [token, setToken] = useState<Address | "">(
      () =>
        workspaceSaved()?.config?.token ||
        saved(CONFIG, null)?.token ||
        localStorage.getItem("pactpay.native.token") ||
        "",
    ),
    [review, setReview] = useState<any>(null),
    [intent, setIntent] = useState<any>(() => {
      try {
        return pending(localStorage);
      } catch (e) {
        return { label: (e as Error).message, invalid: true };
      }
    }),
    [tab, setTab] = useState("agreements");
  const [profileOpen,setProfileOpen]=useState(false);
  const [packages, setPackages] = useState<string[]>(
      () => workspaceSaved()?.packages || saved(PACKAGES, []),
    ),
    [pack, setPack] = useState<NativeQuotePackage | null>(null),
    [importRaw, setImportRaw] = useState(""),
    [snap, setSnap] = useState<Snap | null>(null),
    [quoteVerified, setQuoteVerified] = useState(false),
    [title, setTitle] = useState(draft.title),
    [description, setDescription] = useState(draft.description),
    [merchantName, setMerchantName] = useState(draft.merchantName),
    [members, setMembers] = useState<Member[]>(draft.members),
    [hours, setHours] = useState(draft.hours),
    [captureHours, setCaptureHours] = useState(draft.captureHours),
    [mintTo, setMintTo] = useState(WANTED),
    [mintAmount, setMintAmount] = useState("100");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderPage, setOrderPage] = useState(0);
  const [orderRefresh, setOrderRefresh] = useState(0);
  const [orderReads, setOrderReads] = useState<Record<string, OrderRead>>({});
  const [ordersReading, setOrdersReading] = useState(false);
  const [allowNewDeployment, setAllowNewDeployment] = useState(false);
  const [paymentEvidence, setPaymentEvidence] = useState<any>(null);
  const [orderEvidence, setOrderEvidence] = useState<Record<string, any>>({});
  const [diagnosticAction, setDiagnosticAction] = useState("unknown");
  useEffect(
    () => setOrderEvidence({}),
    [config?.contract, config?.codeHash, config?.tokenCodeHash],
  );
  function receiveEvidence(value: any) {
    setPaymentEvidence(value);
    if (
      value?.id &&
      value.contract?.toLowerCase() === config?.contract.toLowerCase()
    )
      setOrderEvidence((old) => ({ ...old, [value.id]: value }));
  }
  useEffect(
    () => setPaymentEvidence(null),
    [config?.contract, pack?.id, info?.h160],
  );
  accountRef.current = selected;
  contextRef.current = [
    config?.contract || "",
    info?.h160 || "",
    pack?.id || "",
  ].join(":");
  useEffect(() => {
    try {
      const d = parseDraft({
        title,
        description,
        merchantName,
        members,
        hours,
        captureHours,
      });
      localStorage.setItem(DRAFT_KEY, json(d));
    } catch {}
  }, [title, description, merchantName, members, hours, captureHours]);
  function clearDraft() {
    const d = emptyDraft();
    setTitle(d.title);
    setDescription(d.description);
    setMerchantName(d.merchantName);
    setMembers(d.members);
    setHours(d.hours);
    setCaptureHours(d.captureHours);
    setNotice("Draft cleared. Existing agreements and transactions were kept.");
  }
  const formRevision = previewRevision({
    title,
    description,
    merchantName,
    members,
    hours,
    captureHours,
  });
  useEffect(() => {
    setReview((old: any) =>
      old?.draft && old.formRevision !== formRevision ? null : old,
    );
  }, [formRevision]);
  function persistWorkspace(c: Config | null, rawQuotes: string[]) {
    localStorage.setItem(WORKSPACE, json({ config: c, packages: rawQuotes }));
    workspaceRevision.current++;
    try {
      if (c) localStorage.setItem(CONFIG, json(c));
      localStorage.setItem(PACKAGES, json(rawQuotes));
    } catch {
      /* Authoritative workspace already saved atomically; legacy mirrors are optional. */
    }
  }
  async function run(fn: () => Promise<void>) {
    if (!review && document.activeElement instanceof HTMLElement) {
      reviewTrigger.current = document.activeElement;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
      setHistory(nativeHistory(localStorage));
      try {
        setIntent(pending(localStorage));
      } catch (e) {
        setIntent({ label: (e as Error).message, invalid: true });
      }
    }
  }
  async function api() {
    if (!adapter.current) adapter.current = await createNativeAdapter();
    return adapter.current;
  }
  async function selectAccount(address: string) {
    authorityEpoch.current++;
    setSelected(address);
    accountRef.current = address;
    setReview(null);
    setInfo(null);
    setSnap(null);
    setQuoteVerified(false);
    if (address) {
      const a = await api();
      const [nextInfo, nextIdentity, nextHealth] = await Promise.all([
        a.account(address),
        a.identity(),
        a.health(),
      ]);
      if (accountRef.current !== address) return;
      setInfo(nextInfo);
      setIdentity(nextIdentity);
      setHealth(nextHealth);
    }
  }
  const sharedAccountsRef = useRef<{ address: string; source: string }[]>([]);
  async function connect() {
    setDiagnosticAction("connect");
    await run(async () => {
      const list = await connectNativeWallet();
      sharedAccountsRef.current = list;
      setAccounts(list);
      if (!list.length)
        throw Error(
          "No account was shared. Open Polkadot.js and allow this site to see your native account.",
        );
      const next = list.find((a: any) => a.address === WANTED) || list[0];
      await selectAccount(next.address);
      accountSubscription.current?.();
      accountSubscription.current = await subscribeNativeAccounts((updated) => {
        const changed = selectedAuthorityChanged(
          accountRef.current,
          sharedAccountsRef.current,
          updated,
        );
        sharedAccountsRef.current = updated;
        setAccounts(updated);
        if (!changed) return;
        authorityEpoch.current++;
        const change = accountPermissionChange(accountRef.current, updated);
        setReview(null);
        if (change.removed) {
          accountRef.current = "";
          setSelected("");
          setInfo(null);
          setSnap(null);
          setQuoteVerified(false);
          setNotice(
            "This account is no longer shared by Polkadot.js. Select and connect an account before signing.",
          );
        }
      });
      setNotice("Native wallet connected. Review each action before signing.");
    });
  }
  function disconnect() {
    authorityEpoch.current++;
    accountSubscription.current?.();
    accountSubscription.current = null;
    accountRef.current = "";
    setSelected("");
    setAccounts([]);
    setInfo(null);
    setIdentity(null);
    setHealth(null);
    setSnap(null);
    setQuoteVerified(false);
    setReview(null);
    setNotice(
      "Wallet disconnected from this workspace. Existing permissions can be removed in Polkadot.js Extension. Saved agreements and pending transactions remain available.",
    );
  }
  async function requireAccount() {
    const epoch = authorityEpoch.current;
    assertReviewAuthority(
      epoch,
      authorityEpoch.current,
      selected,
      accountRef.current,
    );
    const list = await connectNativeWallet();
    if (!selected || !list.some((a: any) => a.address === selected)) {
      setReview(null);
      throw Error(
        "The selected account is no longer shared by Polkadot.js. Reconnect before signing.",
      );
    }
    const a = await api(),
      h = await a.health();
    setHealth(h);
    if (h.ageMs > 180000)
      throw Error(
        "V3 latest block is stale. Signing is paused until the network resumes.",
      );
    const current = await a.account(selected);
    if (!current.mapped)
      throw Error(
        "This account does not have a verified runtime mapping. No contract transaction will be sent.",
      );
    if (!isAddress(current.h160))
      throw Error("Runtime returned an invalid contract address.");
    assertReviewAuthority(
      epoch,
      authorityEpoch.current,
      selected,
      accountRef.current,
    );
    setInfo(current);
    return { a, current };
  }
  async function verifyConfig(c: Config) {
    if (
      c?.chainId !== 420420777 ||
      !isAddress(c.contract) ||
      !isAddress(c.token) ||
      !/^0x[0-9a-f]{64}$/i.test(c.codeHash) ||
      !/^0x[0-9a-f]{64}$/i.test(c.tokenCodeHash)
    )
      throw Error("Invalid native deployment file.");
    if ((await client.getChainId()) !== 420420777)
      throw Error("EVM read endpoint is on another network.");
    const [code, tcode] = await Promise.all([
      client.getCode({ address: c.contract }),
      client.getCode({ address: c.token }),
    ]);
    if (
      !code ||
      code === "0x" ||
      keccak256(code) !== c.codeHash ||
      !tcode ||
      tcode === "0x" ||
      keccak256(tcode) !== c.tokenCodeHash
    )
      throw Error("Contract code does not match this deployment.");
    const bound = await read(c.contract, "token"),
      dec = await client.readContract({
        address: c.token,
        abi: assetAbi,
        functionName: "decimals",
      });
    if (!same(String(bound), c.token) || dec !== 6)
      throw Error("Escrow token or six-decimal asset verification failed.");
  }
  async function read(
    address: Address,
    name: string,
    args: any[] = [],
    blockNumber?: bigint,
  ): Promise<any> {
    return client.readContract({
      address,
      abi: pactAbi,
      functionName: name,
      args,
      blockNumber,
    } as any);
  }
  function savePackage(p: NativeQuotePackage) {
    const raw = serializeNativePackage(p);
    setPackages((old) => {
      const next = [
        raw,
        ...old.filter((x) => {
          try {
            return JSON.parse(x).id !== p.id;
          } catch {
            return false;
          }
        }),
      ].slice(0, 50);
      persistWorkspace(config, next);
      return next;
    });
    setPack(p);
  }
  async function verifyQuoteOnChain(
    c: Config,
    p: NativeQuotePackage,
    blockNumber?: bigint,
  ) {
    await verifyConfig(c);
    const [q, state, held, onMembers] = await read(
      c.contract,
      "getQuote",
      [p.id],
      blockNumber,
    );
    if (Number(state) === 0)
      throw Error(
        "This file is an unsigned draft. The merchant has not created this agreement on-chain.",
      );
    if (
      hashTypedData(quoteTypedData(420420777, c.contract, q)) !== p.id ||
      onMembers.length !== p.members.length ||
      onMembers.some((m: string, i: number) => !same(m, p.members[i]))
    )
      throw Error("Agreement file does not match on-chain terms or members.");
    for (let i = 0; i < p.members.length; i++) {
      if (
        (await read(
          c.contract,
          "shares",
          [p.id, p.members[i]],
          blockNumber,
        )) !== p.shares[i]
      )
        throw Error("On-chain fixed share differs from the file.");
    }
    return { q, state, held };
  }
  async function refresh(p = pack) {
    setDiagnosticAction("refresh");
    if (!config || !p) return;
    const context = contextRef.current,
      epoch = authorityEpoch.current;
    try {
      const pinned = await client.getBlock({ blockTag: "finalized" });
      const { q, state, held } = await verifyQuoteOnChain(
        config,
        p,
        pinned.number,
      );
      const memberValues = await Promise.all(
        p.members.map(async (address) => ({
          address,
          contributed: BigInt(
            await read(
              config.contract,
              "contributions",
              [p.id, address],
              pinned.number,
            ),
          ),
          credit: BigInt(
            await read(
              config.contract,
              "credits",
              [p.id, address],
              pinned.number,
            ),
          ),
        })),
      );
      const h = info?.h160 as Address | undefined;
      const [block, balance, allowance, owner, share, contributed, credit] =
        await Promise.all([
          Promise.resolve(pinned),
          h
            ? client.readContract({
                address: config.token,
                abi: assetAbi,
                functionName: "balanceOf",
                blockNumber: pinned.number,
                args: [h],
              })
            : 0n,
          h
            ? client.readContract({
                address: config.token,
                abi: assetAbi,
                functionName: "allowance",
                blockNumber: pinned.number,
                args: [h, config.contract],
              })
            : 0n,
          client.readContract({
            address: config.token,
            abi: assetAbi,
            functionName: "owner",
            blockNumber: pinned.number,
          }),
          h ? read(config.contract, "shares", [p.id, h], pinned.number) : 0n,
          h
            ? read(config.contract, "contributions", [p.id, h], pinned.number)
            : 0n,
          h ? read(config.contract, "credits", [p.id, h], pinned.number) : 0n,
        ]);
      if (context !== contextRef.current || epoch !== authorityEpoch.current)
        return;
      setSnap({
        state: Number(state),
        held,
        total: q.total,
        now: block.timestamp,
        balance: BigInt(balance),
        allowance: BigInt(allowance),
        owner: owner as Address,
        share,
        contributed,
        credit,
        members: memberValues,
      });
      setQuoteVerified(true);
      setReadAt(Date.now());
      setReadFailed(false);
      setClock(Date.now());
    } catch (e) {
      if (context === contextRef.current && epoch === authorityEpoch.current) {
        setReadFailed(true);
        setQuoteVerified(false);
      }
      throw e;
    }
  }
  useEffect(() => {
    if (pack && config) {
      void run(() => refresh(pack));
    }
  }, [pack?.id, info?.h160, config?.contract]);
  useEffect(() => {
    const tick = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    const tick = setInterval(() => {
      if (
        document.visibilityState !== "visible" ||
        refreshing.current ||
        busy ||
        review ||
        !pack ||
        !config
      )
        return;
      refreshing.current = true;
      void refresh()
        .catch(() => {})
        .finally(() => {
          refreshing.current = false;
        });
    }, 20000);
    return () => clearInterval(tick);
  }, [pack?.id, config?.contract, info?.h160, busy, review]);
  useEffect(
    () => () => {
      accountSubscription.current?.();
      void adapter.current?.disconnect?.();
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;
    setOrderReads({});
    if (!config || tab !== "agreements") return;
    const c = config;
    const rows = packages.slice(orderPage * 8, orderPage * 8 + 8);
    setOrdersReading(true);
    void (async () => {
      for (const raw of rows) {
        if (cancelled) break;
        try {
          const p = parseNativePackage(raw, c);
          const block = await client.getBlock({ blockTag: "finalized" });
          const { state, held } = await verifyQuoteOnChain(c, p, block.number);
          const merchantCredit = await read(
            c.contract,
            "credits",
            [p.id, p.quote.merchant],
            block.number,
          );
          const contributions = await Promise.all(
            p.members.map((member) =>
              read(c.contract, "contributions", [p.id, member], block.number),
            ),
          );
          const refunds = await Promise.all(
            p.members.map((member) =>
              read(c.contract, "credits", [p.id, member], block.number),
            ),
          );
          if (Date.now() - Number(block.timestamp) * 1000 > 180000)
            throw Error("Latest block is stale");
          if (!cancelled)
            setOrderReads((old) => ({
              ...old,
              [p.id]: {
                state: Number(state),
                held,
                merchantCredit,
                fundedMembers: contributions.filter((n) => BigInt(n) > 0n)
                  .length,
                collected: contributions.reduce(
                  (sum: bigint, n) => sum + BigInt(n),
                  0n,
                ),
                refundCredit:
                  Number(state) >= 4
                    ? refunds.reduce((sum: bigint, n) => sum + BigInt(n), 0n)
                    : 0n,
                blockHash: block.hash,
                blockNumber: String(block.number),
                now: block.timestamp,
                at: Date.now(),
              },
            }));
        } catch {
          /* Saved bytes never establish chain status. */
        }
      }
    })().finally(() => {
      if (!cancelled) setOrdersReading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [config?.contract, packages, orderPage, orderRefresh, tab]);
  function useWorkshopTemplate() {
    setTitle("Shared design workshop");
    setDescription(
      "A shared workshop booking for the members listed below. Confirm the session date, location and deliverables with the merchant before contributing.\n\n" +
        workshopPolicy,
    );
    setHours("24");
    setCaptureHours("24");
    setNotice(
      "Workshop booking policy added to the terms. Complete the session details before creating the agreement.",
    );
  }
  async function prepareCall(
    label: string,
    target: Address,
    data: Hex,
    after?: () => Promise<void>,
  ) {
    const epoch = authorityEpoch.current;
    const { a } = await requireAccount();
    if (!config) throw Error("Set up a native deployment first.");
    await verifyConfig(config);
    const tx = await a.prepareCall(selected, target, data, label);
    assertReviewAuthority(
      epoch,
      authorityEpoch.current,
      selected,
      accountRef.current,
    );
    setReview({
      tx,
      after,
      label,
      target,
      account: selected,
      authorityEpoch: epoch,
    });
  }
  async function prepareAtomicCalls(label:string,calls:readonly {to:Address;data:Hex}[]) {
    const epoch=authorityEpoch.current;const {a}=await requireAccount();if(!config)throw Error("Set up a native deployment first.");await verifyConfig(config);
    const tx=await a.prepareBatch(selected,calls,label);assertReviewAuthority(epoch,authorityEpoch.current,selected,accountRef.current);
    setReview({tx,label,target:config.contract,account:selected,authorityEpoch:epoch});
  }
  async function prepareDeploy(kind: "token" | "escrow") {
    setDiagnosticAction("deploy");
    await run(async () => {
      if (
        !allowNewDeployment &&
        ((kind === "token" && isAddress(token)) ||
          (kind === "escrow" && config))
      )
        throw Error(
          "A deployment already exists. Reuse or verify it; enable a separate new workspace only if you intend to pay another deployment deposit.",
        );
      const epoch = authorityEpoch.current;
      const { a } = await requireAccount();
      const name = kind === "token" ? "DemoUSD" : "PactPayNative",
        r = await fetch("/deploy-artifacts/" + name + ".json");
      if (!r.ok) throw Error("Deployment artifact unavailable.");
      const art = await r.json();
      if (kind === "escrow") {
        if (!isAddress(token))
          throw Error("Deploy or import the test token first.");
        if (
          (await client.readContract({
            address: token,
            abi: assetAbi,
            functionName: "decimals",
          })) !== 6
        )
          throw Error("Six-decimal token required.");
      }
      const code = encodeDeployData({
          abi: art.abi,
          bytecode: art.bytecode,
          args: kind === "token" ? [] : [token],
        }),
        tx = await a.prepareDeploy(
          selected,
          code,
          kind === "token"
            ? "Deploy test payment token"
            : "Deploy PactPay escrow",
        );
      assertReviewAuthority(
        epoch,
        authorityEpoch.current,
        selected,
        accountRef.current,
      );
      setReview({
        tx,
        label:
          kind === "token"
            ? "Deploy test payment token"
            : "Deploy PactPay escrow",
        account: selected,
        authorityEpoch: epoch,
        kind,
      });
    });
  }
  async function finalizeDeploy(
    kind: string,
    result: any,
    tx: any,
    recoveredToken?: Address,
  ) {
    const paymentToken = recoveredToken || token;
    const address = result.contractAddress || tx.predictedContract;
    if (!isAddress(address))
      throw Error(
        "No verified contract address was returned. Keep the finalized transaction hash for investigation.",
      );
    const code = await client.getCode({ address });
    if (!code || code === "0x")
      throw Error(
        "Finalized deployment has no contract code at the expected address.",
      );
    if (kind === "token") {
      if (
        (await client.readContract({
          address,
          abi: assetAbi,
          functionName: "decimals",
        })) !== 6
      )
        throw Error("Unexpected test token decimals.");
      setToken(address);
      localStorage.setItem("pactpay.native.token", address);
      setTab("setup");
      return;
    }
    const tcode = await client.getCode({ address: paymentToken as Address });
    if (!tcode || tcode === "0x") throw Error("Payment token code missing.");
    const c: Config = {
      chainId: 420420777,
      contract: address,
      token: paymentToken as Address,
      codeHash: keccak256(code),
      tokenCodeHash: keccak256(tcode),
      blockNumber: String(await client.getBlockNumber()),
    };
    await verifyConfig(c);
    persistWorkspace(c, []);
    setConfig(c);
    setPackages([]);
    setPack(null);
    setSnap(null);
    setQuoteVerified(false);
    setConfigRaw(json(c));
  }
  async function confirm() {
    const currentReview = review;
    await run(async () => {
      if (currentReview?.draft && currentReview.formRevision !== formRevision)
        throw Error("Agreement details changed. Review creation again.");
      if (
        currentReview?.draft &&
        BigInt(Math.floor(Date.now() / 1000)) >=
          currentReview.draft.quote.fundingDeadline
      )
        throw Error("Funding deadline passed. Prepare a new agreement review.");
      if (!currentReview || currentReview.account !== selected)
        throw Error("Account changed. Prepare the action again.");
      assertReviewAuthority(
        currentReview.authorityEpoch,
        authorityEpoch.current,
        currentReview.account,
        accountRef.current,
      );
      await requireAccount();
      if (
        config &&
        currentReview.kind !== "token" &&
        currentReview.kind !== "escrow"
      )
        await verifyConfig(config);
      assertReviewAuthority(
        currentReview.authorityEpoch,
        authorityEpoch.current,
        currentReview.account,
        accountRef.current,
      );
      setReview(null);
      localStorage.setItem(
        RECOVERY,
        json({
          kind: currentReview.kind,
          token,
          tx: currentReview.tx,
          draft: currentReview.draft,
        }),
      );
      assertReviewAuthority(
        currentReview.authorityEpoch,
        authorityEpoch.current,
        currentReview.account,
        accountRef.current,
      );
      const result = await adapter.current.signAndSend(
        currentReview.tx,
        localStorage,
      );
      if (currentReview.kind)
        await finalizeDeploy(currentReview.kind, result, currentReview.tx);
      if (currentReview.after) await currentReview.after();
      await adapter.current.acknowledge?.(localStorage, result);
      localStorage.removeItem(RECOVERY);
      setInfo(await adapter.current.account(selected));
      setNotice("Finalized successfully. Transaction " + result.hash);
      if (pack && config) await refresh();
    });
  }
  async function recover() {
    setDiagnosticAction("recover");
    await run(async () => {
      const a = await api(),
        result = await a.recover(localStorage);
      const context = saved(RECOVERY, null);
      if (result && context?.kind) {
        if (context.token) setToken(context.token);
        await finalizeDeploy(context.kind, result, context.tx, context.token);
      }
      if (result && context?.draft && config) {
        const recovered = parseNativePackage(
          JSON.stringify(context.draft),
          config,
        );
        await refresh(recovered);
        savePackage(recovered);
        setTab("agreements");
      }
      if (result) {
        await a.acknowledge?.(localStorage, result);
        localStorage.removeItem(RECOVERY);
      }
      setNotice(
        result
          ? "Transaction reconciled: " +
              (result.hash || result.status || "check chain state")
          : "No pending native transaction.",
      );
      if (pack && config) await refresh();
      if (selected) setInfo(await a.account(selected));
    });
  }
  async function createQuote() {
    setDiagnosticAction("create");
    await run(async () => {
      const epoch = authorityEpoch.current;
      if (!config) throw Error("Set up a deployment first.");
      try {
        if (BigInt(await read(config.contract, "MAX_TERMS_BYTES")) !== 16000n)
          throw Error("Unsupported public terms limit.");
      } catch {
        throw Error(
          "This escrow does not support recoverable original terms. Deploy and verify the updated PactPay escrow before creating new agreements.",
        );
      }
      const { a, current } = await requireAccount();
      if (
        !title.trim() ||
        title.length > 120 ||
        description.length > 4000 ||
        merchantName.length > 100
      )
        throw Error("Enter a title and valid agreement details.");
      if (
        !/^\d+$/.test(hours) ||
        !/^\d+$/.test(captureHours) ||
        Number(hours) < 1 ||
        Number(hours) > 720 ||
        Number(captureHours) < 1 ||
        Number(captureHours) > 720
      )
        throw Error("Funding and capture windows must be 1–720 hours.");
      const resolved = await Promise.all(
        members.map(async (m) => {
          if (!m.address.startsWith("5"))
            throw Error("Use a native SS58 member address.");
          const x = await a.account(m.address);
          if (!x.mapped || !isAddress(x.h160))
            throw Error("A member has no verified native mapping.");
          return x.h160 as Address;
        }),
      );
      if (
        new Set(resolved.map((x) => x.toLowerCase())).size !== resolved.length
      )
        throw Error("Each member must be distinct.");
      const shares = members.map((m, i) => {
        try {
          return exactShare(m.amount);
        } catch {
          throw Error(
            `Member ${i + 1}: enter a positive share with at most six decimals.`,
          );
        }
      });
      if (shares.some((s) => s <= 0n))
        throw Error("Every fixed share must be positive.");
      const block = await client.getBlock(),
        terms: Terms = {
          title: title.trim(),
          description,
          merchantName,
          currency: "dUSD",
        },
        nonce = BigInt(
          "0x" +
            [...crypto.getRandomValues(new Uint8Array(16))]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
        ),
        q = makeQuote(
          current.h160,
          config.token,
          terms,
          resolved,
          shares,
          block.timestamp + BigInt(hours) * 3600n,
          block.timestamp +
            BigInt(Number(hours) + Number(captureHours)) * 3600n,
          nonce,
        ),
        id = hashTypedData(quoteTypedData(420420777, config.contract, q));
      const p: NativeQuotePackage = {
        schema: "pactpay-native-v1",
        chainId: 420420777,
        contract: config.contract,
        terms,
        quote: q,
        members: resolved,
        shares,
        id,
      };
      await prepareCall(
        "Create fixed-share agreement",
        config.contract,
        encodeFunctionData({
          abi: pactAbi,
          functionName: "createQuoteNativeWithTerms",
          args: [q, resolved, shares, canonicalTerms(terms)],
        }),
        async () => {
          savePackage(p);
          setTab("agreements");
        },
      );
      assertReviewAuthority(
        epoch,
        authorityEpoch.current,
        selected,
        accountRef.current,
      );
      setReview((r: any) =>
        r && r.authorityEpoch === epoch && authorityEpoch.current === epoch
          ? { ...r, draft: p, formRevision }
          : null,
      );
    });
  }
  async function action(name: string, label: string) {
    await run(async () => {
      if (!config || !pack || !quoteVerified)
        throw Error("Select and verify an on-chain agreement.");
      await refresh();
      setDiagnosticAction(name);
      const {a:batchAdapter}=await requireAccount();
      if(batchAdapter.supportsAtomicBatch && (name==='capture'||name==='expire')){
        await prepareAtomicCalls(name==='capture'?'Capture and claim merchant credit':'Process expiry and claim your refund',[
          {to:config.contract,data:encodeFunctionData({abi:pactAbi,functionName:name,args:[pack.id]} as any)},
          {to:config.contract,data:encodeFunctionData({abi:pactAbi,functionName:'claim',args:[pack.id]} as any)},
        ]);return;
      }
      const args =
        name === "contribute" ? [pack.id, pack.quote.termsHash] : [pack.id];
      await prepareCall(
        label,
        config.contract,
        encodeFunctionData({ abi: pactAbi, functionName: name, args } as any),
      );
    });
  }
  async function approve() {
    setDiagnosticAction("approve");
    await run(async () => {
      if (!config || !pack || !snap || !quoteVerified)
        throw Error("Select a verified agreement.");
      await refresh();
      const {a:batchAdapter}=await requireAccount();
      if(batchAdapter.supportsAtomicBatch){await prepareAtomicCalls('Approve your exact share and pay',[
        {to:config.token,data:encodeFunctionData({abi:assetAbi,functionName:'approve',args:[config.contract,snap.share]})},
        {to:config.contract,data:encodeFunctionData({abi:pactAbi,functionName:'contribute',args:[pack.id,pack.quote.termsHash]} as any)},
      ]);return;}
      await prepareCall(
        "Approve exact fixed share " + amount(snap.share) + " dUSD",
        config.token,
        encodeFunctionData({
          abi: assetAbi,
          functionName: "approve",
          args: [config.contract, snap.share],
        }),
      );
    });
  }
  async function revokeApproval() {
    await run(async () => {
      if (!config || !pack || !quoteVerified)
        throw Error("Select a verified agreement.");
      await refresh();
      await prepareCall(
        "Revoke this escrow’s token spending approval",
        config.token,
        encodeFunctionData({
          abi: assetAbi,
          functionName: "approve",
          args: [config.contract, 0n],
        }),
      );
    });
  }
  async function mint() {
    setDiagnosticAction("mint");
    await run(async () => {
      if (!config) throw Error("Deploy the test token and escrow first.");
      const { a, current } = await requireAccount();
      const owner = await client.readContract({
        address: config.token,
        abi: assetAbi,
        functionName: "owner",
      });
      if (!same(owner, current.h160))
        throw Error("Only the test token deployer can mint demo funds.");
      const to = await a.account(mintTo),
        n = parseUnits(mintAmount, 6);
      if (
        !to.mapped ||
        !isAddress(to.h160) ||
        n <= 0n ||
        n > 1000000n * 1000000n
      )
        throw Error("Choose a mapped recipient and 0–1,000,000 demo tokens.");
      await prepareCall(
        "Mint " + amount(n) + " demo dUSD to " + short(mintTo),
        config.token,
        encodeFunctionData({
          abi: assetAbi,
          functionName: "mint",
          args: [to.h160, n],
        }),
      );
    });
  }
  async function importPackage(raw = importRaw) {
    await run(async () => {
      if (!config) throw Error("Import a deployment first.");
      const p = parseNativePackage(raw, config);
      await refresh(p);
      savePackage(p);
      setImportRaw("");
      setTab("agreements");
      setNotice("Agreement bytes and on-chain creation verified.");
    });
  }
  async function importWorkspace(bundle: NativeTransferBundle) {
    if (pending(localStorage) || busy || review)
      throw Error(
        "Resolve the pending transaction or close the review before importing a workspace.",
      );
    const epoch = authorityEpoch.current,
      oldContext = contextRef.current,
      revision = workspaceRevision.current,
      c = bundle.deployment as Config;
    setBusy(true);
    try {
      const parsed = bundle.agreements.map((raw) => parseNativePackage(raw, c));
      await verifyConfig(c);
      for (const p of parsed) await verifyQuoteOnChain(c, p);
      if (
        pending(localStorage) ||
        authorityEpoch.current !== epoch ||
        oldContext !== contextRef.current ||
        revision !== workspaceRevision.current
      )
        throw Error(
          "Workspace or wallet changed during verification. Review the import again.",
        );
      const incoming = parsed.map(serializeNativePackage);
      const merged =
        bundle.kind === "agreement" && same(config?.contract, c.contract)
          ? [
              ...incoming,
              ...packages.filter(
                (raw) =>
                  !parsed.some((p) => {
                    try {
                      return JSON.parse(raw).id === p.id;
                    } catch {
                      return false;
                    }
                  }),
              ),
            ].slice(0, 50)
          : incoming;
      persistWorkspace(c, merged);
      setConfig(c);
      setToken(c.token);
      setConfigRaw(json(c));
      setPackages(merged);
      setPack(parsed[0] || null);
      setSnap(null);
      setQuoteVerified(false);
      setReadAt(0);
      setReview(null);
      setTab("agreements");
      setNotice(
        "Workspace verified and imported. No wallet request or payment was made.",
      );
    } finally {
      setBusy(false);
    }
  }
  const snapshotFresh = isSnapshotFresh(readAt, clock, readFailed);
  const blocked = busy || !!intent || !!review || health?.ageMs > 180000,
    merchant = same(info?.h160, pack?.quote.merchant),
    funding =
      snap?.state === 1 && !!pack && snap.now < pack.quote.fundingDeadline,
    ready =
      snap?.state === 2 && !!pack && snap.now < pack.quote.captureDeadline;
  const primaryCheckout = checkoutAction({
    connected: !!selected,
    mapped: !!info?.mapped,
    fresh: !!snap && quoteVerified && snapshotFresh,
    pending: !!intent,
    state: snap?.state ?? 0,
    now: snap?.now ?? 0n,
    funding: pack?.quote.fundingDeadline ?? 0n,
    capture: pack?.quote.captureDeadline ?? 0n,
    share: snap?.share ?? 0n,
    contributed: snap?.contributed ?? 0n,
    credit: snap?.credit ?? 0n,
    balance: snap?.balance ?? 0n,
    allowance: snap?.allowance ?? 0n,
    merchant,
  });
  async function takeCheckoutStep() {
    switch (primaryCheckout.action) {
      case "connect":
        return connect();
      case "recover":
        return run(recover);
      case "refresh":
        return run(() => refresh());
      case "approve":
        return approve();
      case "contribute":
        return action("contribute", "Contribute your fixed share");
      case "capture":
        return action(
          "capture",
          "Capture collection into merchant claimable credit",
        );
      case "claim":
        return action("claim", "Claim available credit to your wallet");
      case "expire":
        return action(
          "expire",
          "Expire agreement and release contributor refunds",
        );
    }
  }
  return (
    <div className="native-app">
      <ExternalWalletProfile open={profileOpen} onClose={()=>setProfileOpen(false)} address={selected} network="Portaldot V3 testnet" mode="native" balance={info?native(BigInt(info.balance))+' tPOT':undefined}/>
      <header className="native-header">
        <a href="/" className="native-brand">
          <strong>
            <img className="pactpay-logo" src="/art/pactpay/pactpay-logo.webp" width="144" height="48" alt="PactPay" />
            <span>Native wallet workspace</span>
          </strong>
        </a>
        <span className="native-network">
          <i />
          Portaldot V3 Testnet
        </span>
        <button onClick={connect} disabled={busy} className="native-connect">
          <Wallet size={17} />
          {selected ? short(selected) : "Connect Polkadot.js"}
        </button>
        {selected&&<button className="native-disconnect" onClick={()=>setProfileOpen(true)}>Profile</button>}
        {selected && (
          <button
            className="native-disconnect"
            disabled={busy}
            onClick={disconnect}
          >
            Disconnect wallet
          </button>
        )}
      </header>
      <main className="native-main" aria-busy={busy}>
        <a className="native-back" href="/evm">
          <ArrowLeft size={15} /> EVM wallet workspace
        </a>
        <div className="native-title">
          <div>
            <p className="native-eyebrow">
              ONE AGREEMENT. EVERY SHARE ACCOUNTED FOR.
            </p>
            <h1>Pay together, with your native wallet.</h1>
            <p>
              Use Polkadot.js to review and sign. Your native tPOT pays network
              fees; dUSD is the demo payment asset.
            </p>
          </div>
          <span className="native-nativebadge">
            <ShieldCheck size={18} /> You hold the keys
          </span>
        </div>
        <section className="native-walletcard">
          <div>
            <span className="native-kicker">CONNECTED ACCOUNT</span>
            {accounts.length ? (
              <label className="native-sr">
                Native account
                <select
                  value={selected}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() => selectAccount(e.target.value))
                  }
                >
                  {accounts.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.name || "Native account"} · {a.address}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="native-muted">
                Connect Polkadot.js Extension to share your native account.
              </p>
            )}
            {selected && <p className="native-address">{selected}</p>}
            <span className="native-muted">
              {info?.mapped
                ? "Runtime mapping verified"
                : "Mapping not verified"}
              {info?.h160 ? " · " + short(info.h160) : ""}
            </span>
          </div>
          <div className="native-balance">
            <span>Native balance</span>
            <strong>
              {info ? native(BigInt(info.balance)) : "—"} <small>tPOT</small>
            </strong>
            <span>
              {identity
                ? "V3 runtime " + identity.specVersion
                : "Read-only until connected"}
            </span>
          </div>
          <button
            className="native-icon"
            aria-label="Refresh account and agreement"
            disabled={busy || !selected}
            onClick={() =>
              void run(async () => {
                await selectAccount(selected);
                if (pack) await refresh();
              })
            }
          >
            <RefreshCw size={18} />
          </button>
        </section>
        {health?.ageMs > 180000 && (
          <div className="native-alert native-error" role="alert">
            V3 block production appears paused. Latest block{" "}
            {String(health.head)} is {Math.floor(health.ageMs / 60000)} minutes
            old. You can inspect state, but signing is paused until fresh blocks
            resume.
          </div>
        )}
        {error && (
          <div className="native-alert native-error" role="alert">
            {error}
            <DiagnosticsPanel
              actionCode={diagnosticAction}
              runtimeVersion={identity?.specVersion}
              blockNumber={
                health?.finalized === undefined
                  ? undefined
                  : String(health.finalized)
              }
              transactionHash={intent?.hash}
              error={error}
              contract={config?.contract}
              quoteId={pack?.id}
            />
          </div>
        )}
        {notice && (
          <div className="native-alert native-success" role="status">
            {notice}
          </div>
        )}
        {intent && (
          <section className="native-pending">
            <Clock size={22} />
            <div>
              <h2>One transaction needs reconciliation</h2>
              <p>
                Do not sign a duplicate. Check the saved transaction against
                finalized chain history.
              </p>
              <code>
                {intent.hash ||
                  intent.label ||
                  "Wallet request outcome unknown"}
              </code>
            </div>
            <button disabled={busy} onClick={recover}>
              Check transaction
            </button>
          </section>
        )}
        <nav className="native-tabs" aria-label="Native workspace">
          <button
            aria-current={tab === "activity" ? "page" : undefined}
            className={tab === "activity" ? "active" : ""}
            onClick={() => {
              setHistory(nativeHistory(localStorage));
              setTab("activity");
            }}
          >
            Activity
          </button>
          <button
            aria-current={tab === "agreements" ? "page" : undefined}
            className={tab === "agreements" ? "active" : ""}
            onClick={() => setTab("agreements")}
          >
            Agreements
          </button>
          <button
            aria-current={tab === "create" ? "page" : undefined}
            className={tab === "create" ? "active" : ""}
            onClick={() => setTab("create")}
          >
            Create agreement
          </button>
          <button
            aria-current={tab === "setup" ? "page" : undefined}
            className={tab === "setup" ? "active" : ""}
            onClick={() => setTab("setup")}
          >
            Deployment & test funds
          </button>
        </nav>
        {tab === "activity" && (
          <section className="native-panel native-activity">
            <div className="native-paneltitle">
              <h2>Wallet activity</h2>
              <button
                className="native-secondary"
                disabled={!history.length}
                onClick={() =>
                  download(json(history), "pactpay-native-activity.json")
                }
              >
                <Download size={16} />
                Export activity
              </button>
            </div>
            <p className="native-muted">
              Saved transaction outcomes from this browser. Pending or failed
              requests are not completed payments. Up to 50 recent records are
              shown.
            </p>
            {!history.length ? (
              <div className="native-empty">
                <Clock size={28} />
                <h3>No transactions recorded yet.</h3>
                <p>Your signed actions and their outcomes will appear here.</p>
              </div>
            ) : (
              history.slice(0, 50).map((row) => (
                <article className="native-activityrow" key={row.id}>
                  <div>
                    <strong>{row.label || "Native transaction"}</strong>
                    <span className="native-status">{row.status}</span>
                  </div>
                  <p>Account {row.address}</p>
                  {row.createdAt && (
                    <time>{new Date(row.createdAt).toLocaleString()}</time>
                  )}
                  {row.hash && (
                    <>
                      <label>
                        Transaction hash<code>{row.hash}</code>
                      </label>
                      <button
                        className="native-secondary"
                        onClick={() =>
                          void run(async () => {
                            await navigator.clipboard.writeText(row.hash);
                            setNotice("Transaction hash copied.");
                          })
                        }
                      >
                        Copy transaction hash
                      </button>
                    </>
                  )}
                  {row.blockHash && (
                    <label>
                      Finalized block hash<code>{row.blockHash}</code>
                    </label>
                  )}
                  {row.error && <p className="native-error">{row.error}</p>}
                </article>
              ))
            )}
          </section>
        )}
        {tab === "agreements" && (
          <div className="native-columns">
            <section className="native-panel">
              <div className="native-paneltitle">
                <h2>Orders & member checkout</h2>
                <button
                  className="native-icon"
                  aria-label="Create agreement"
                  onClick={() => setTab("create")}
                >
                  <Plus size={18} />
                </button>
              </div>
              <p className="native-muted">
                Saved agreement files are verified against the chain below.
                Status is unknown until a successful read.
              </p>
              <div className="native-ordercontrols">
                <MerchantDashboard
                  account={info?.h160}
                  rows={
                    config
                      ? packages.flatMap((raw) => {
                          try {
                            const p = parseNativePackage(raw, config);
                            return [
                              ledgerRow(
                                p,
                                orderReads[p.id],
                                clock,
                                packages.flatMap((r) => {
                                  try {
                                    return [parseNativePackage(r, config).id];
                                  } catch {
                                    return [];
                                  }
                                }),
                                orderEvidence[p.id],
                              ),
                            ];
                          } catch {
                            return [];
                          }
                        })
                      : []
                  }
                />
                <label>
                  Search this page
                  <input
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Title, merchant or agreement ID"
                  />
                </label>
                <label>
                  Show orders
                  <select
                    aria-label="Show orders"
                    value={orderFilter}
                    onChange={(e) => setOrderFilter(e.target.value)}
                  >
                    <option value="all">All orders</option>
                    <option value="mine">My merchant orders</option>
                    <option value="collecting">Collecting</option>
                    <option value="ready">Ready to capture</option>
                    <option value="expiry">Needs expiry</option>
                    <option value="closed">Closed</option>
                    <option value="unknown">Unknown or stale</option>
                  </select>
                </label>
                <button
                  className="native-secondary"
                  disabled={ordersReading || !config}
                  onClick={() => setOrderRefresh((n) => n + 1)}
                >
                  Refresh order statuses
                </button>
              </div>
              {ordersReading && (
                <p role="status">Verifying this page against the chain-</p>
              )}
              {!packages.length ? (
                <div className="native-empty">
                  <Users size={30} />
                  <h3>Start your first shared payment</h3>
                  <p>
                    Create a fixed-share agreement or import one created by a
                    merchant.
                  </p>
                  <button onClick={() => setTab(config ? "create" : "setup")}>
                    {config ? "Create agreement" : "Set up deployment"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                packages
                  .slice(orderPage * 8, orderPage * 8 + 8)
                  .map((raw, i) => {
                    try {
                      if (!config) return null;
                      const x = parseNativePackage(raw, config);
                      const cached = orderReads[x.id];
                      const status =
                        cached && isSnapshotFresh(cached.at, clock, false)
                          ? cached
                          : null;
                      const needsExpiry =
                        !!status &&
                        ((status.state === 1 &&
                          status.now >= x.quote.fundingDeadline) ||
                          (status.state === 2 &&
                            status.now >= x.quote.captureDeadline));
                      if (
                        orderSearch &&
                        ![x.terms.title, x.terms.merchantName, x.id]
                          .join(" ")
                          .toLowerCase()
                          .includes(orderSearch.toLowerCase())
                      )
                        return null;
                      if (
                        (orderFilter === "mine" &&
                          !same(info?.h160, x.quote.merchant)) ||
                        (orderFilter === "collecting" &&
                          (!status || status.state !== 1 || needsExpiry)) ||
                        (orderFilter === "ready" &&
                          (!status || status.state !== 2 || needsExpiry)) ||
                        (orderFilter === "expiry" && !needsExpiry) ||
                        (orderFilter === "closed" &&
                          (!status || status.state < 3)) ||
                        (orderFilter === "unknown" && status)
                      )
                        return null;
                      return (
                        <button
                          disabled={busy || !!review}
                          aria-pressed={pack?.id === x.id}
                          className={
                            "native-agreement " +
                            (pack?.id === x.id ? "selected" : "")
                          }
                          key={x.id}
                          onClick={() =>
                            void run(async () => {
                              if (!config)
                                throw Error(
                                  "Import the matching deployment first.",
                                );
                              const p = parseNativePackage(raw, config);
                              await refresh(p);
                              setPack(p);
                            })
                          }
                        >
                          <strong>{x.terms.title}</strong>
                          <small>
                            {orderReference(
                              x.id,
                              packages.flatMap((raw) => {
                                try {
                                  return [parseNativePackage(raw, config).id];
                                } catch {
                                  return [];
                                }
                              }),
                            )}
                          </small>
                          <span>
                            {x.members.length} members ·{" "}
                            {amount(BigInt(x.quote.total))} dUSD
                          </span>
                          <small>{short(x.id)}</small>
                          <span className="native-orderstate">
                            {status
                              ? needsExpiry
                                ? "Needs expiry processing"
                                : states[status.state]
                              : "Unknown - refresh to verify"}
                          </span>
                          {status && (
                            <small>
                              {amount(status.held)} dUSD held - checked{" "}
                              {new Date(status.at).toLocaleTimeString()}
                            </small>
                          )}
                          <small>
                            {needsExpiry
                              ? "Open to review expiry"
                              : status?.state === 2
                                ? "Open to review capture"
                                : "Open member checkout"}
                          </small>
                        </button>
                      );
                    } catch {
                      return <p key={i}>Saved agreement could not be read.</p>;
                    }
                  })
              )}
              {packages.length > 8 && (
                <div className="native-pagecontrols">
                  <button
                    className="native-secondary"
                    disabled={orderPage === 0}
                    onClick={() => setOrderPage((n) => n - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {orderPage + 1} of {Math.ceil(packages.length / 8)} - 8
                    orders per chain read
                  </span>
                  <button
                    className="native-secondary"
                    disabled={(orderPage + 1) * 8 >= packages.length}
                    onClick={() => setOrderPage((n) => n + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
              <details className="native-import">
                <summary>Import an agreement</summary>
                <label>
                  Agreement JSON
                  <textarea
                    aria-label="Agreement JSON"
                    rows={5}
                    value={importRaw}
                    onChange={(e) => setImportRaw(e.target.value)}
                  />
                </label>
                <button
                  disabled={blocked || !importRaw || !config}
                  onClick={() => importPackage()}
                >
                  <Upload size={15} />
                  Verify and open
                </button>
                <p>
                  Files are checked against on-chain creation before payment is
                  enabled.
                </p>
              </details>
            </section>
            <section className="native-panel native-detail">
              {!pack ? (
                <div className="native-empty">
                  <ShieldCheck size={32} />
                  <h2>Every payment starts with clear terms.</h2>
                  <p>
                    Select an agreement to see its fixed shares, deadlines and
                    available actions.
                  </p>
                </div>
              ) : (
                <>
                  <div className="native-paneltitle">
                    <span className="native-status">
                      {quoteVerified && snap
                        ? states[snap.state]
                        : "Not verified"}
                    </span>
                    <button
                      className="native-icon"
                      aria-label="Export current agreement"
                      onClick={() =>
                        download(
                          serializeNativePackage(pack),
                          "pactpay-native-agreement.json",
                        )
                      }
                    >
                      <Download size={18} />
                    </button>
                  </div>
                  <h2>{pack.terms.title}</h2>
                  <p className="native-description">
                    {pack.terms.description || "No additional description."}
                  </p>
                  <p className="native-muted">
                    Merchant{" "}
                    {pack.terms.merchantName || short(pack.quote.merchant)} ·{" "}
                    {merchant ? "Your wallet" : "Another account"}
                  </p>
                  <div className="native-stats">
                    <div>
                      <span>Agreement total</span>
                      <strong>
                        {amount(pack.quote.total)}
                        <small>dUSD</small>
                      </strong>
                    </div>
                    <div>
                      <span>Held in escrow</span>
                      <strong>
                        {snap ? amount(snap.held) : "—"}
                        <small>dUSD</small>
                      </strong>
                    </div>
                    <div>
                      <span>Your claimable</span>
                      <strong>
                        {snap ? amount(snap.credit) : "—"}
                        <small>dUSD</small>
                      </strong>
                    </div>
                  </div>
                  <section
                    className="native-checkout"
                    aria-label="Member checkout"
                  >
                    <span className="native-kicker">YOUR NEXT STEP</span>
                    <h3>
                      {checkoutNext({
                        connected: !!selected,
                        mapped: !!info?.mapped,
                        fresh: !!snap && quoteVerified && snapshotFresh,
                        state: snap?.state ?? 0,
                        now: snap?.now ?? 0n,
                        funding: pack.quote.fundingDeadline,
                        capture: pack.quote.captureDeadline,
                        share: snap?.share ?? 0n,
                        contributed: snap?.contributed ?? 0n,
                        credit: snap?.credit ?? 0n,
                        balance: snap?.balance ?? 0n,
                        allowance: snap?.allowance ?? 0n,
                        merchant,
                      })}
                    </h3>
                    <p role="status">{primaryCheckout.reason}</p>
                    <button
                      disabled={
                        !primaryCheckout.enabled ||
                        busy ||
                        !!review ||
                        (primaryCheckout.action !== "recover" &&
                          primaryCheckout.action !== "connect" &&
                          primaryCheckout.action !== "refresh" &&
                          blocked)
                      }
                      onClick={() => void takeCheckoutStep()}
                    >
                      {primaryCheckout.label}
                    </button>
                    {health?.ageMs > 180000 && (
                      <p role="alert">
                        The chain connection is behind. Refresh the connection
                        before requesting a payment signature.
                      </p>
                    )}
                    <dl className="native-prerequisites">
                      <div>
                        <dt>Runtime mapping</dt>
                        <dd>
                          {info?.mapped
                            ? "Verified for connected wallet"
                            : "Connect and verify"}
                        </dd>
                      </div>
                      <div>
                        <dt>Payment balance</dt>
                        <dd>
                          {snap && snapshotFresh && quoteVerified && selected
                            ? `${amount(snap.balance)} dUSD / ${amount(snap.share)} dUSD share`
                            : "Refresh with your wallet connected"}
                        </dd>
                      </div>
                      <div>
                        <dt>Token approval</dt>
                        <dd>
                          {snap && snapshotFresh && quoteVerified && selected
                            ? `${amount(snap.allowance)} dUSD approved - approval is not payment`
                            : "Not verified"}
                        </dd>
                      </div>
                      <div>
                        <dt>Native fees & storage</dt>
                        <dd>
                          {info
                            ? `${native(BigInt(info.spendable ?? 0))} tPOT available; exact costs checked in review`
                            : "Connect wallet to check native funds"}
                        </dd>
                      </div>
                    </dl>
                    <p className="native-footnote">
                      PactPay records collection and refunds. Capture does not
                      prove workshop delivery or guarantee a service. Review the
                      merchant’s booking policy above before contributing.
                    </p>
                  </section>
                  <h3>Fixed shares</h3>
                  <p role="status">
                    {
                      paymentLabels[
                        paymentStatus(
                          snap?.state ?? 0,
                          snap?.credit ?? 0n,
                          paymentEvidence?.id === pack.id
                            ? claimKindFromEvents(
                                paymentEvidence.events,
                                snap?.state ?? 0,
                                pack.id,
                                info?.h160,
                                pack.quote.merchant,
                                merchant && snap?.state === 3
                                  ? pack.quote.total
                                  : (snap?.share ?? 0n),
                              )
                            : "unknown",
                          merchant,
                          !!snap && snapshotFresh && quoteVerified,
                        )
                      ]
                    }
                  </p>
                  <ul className="native-members">
                    {pack.members.map((m, i) => (
                      <li key={m}>
                        <span>{same(m, info?.h160) ? "You" : short(m)}</span>
                        <strong>{amount(pack.shares[i])} dUSD</strong>
                        {snap?.members[i] && (
                          <span className="native-memberstate">
                            Contributed {amount(snap.members[i].contributed)}{" "}
                            dUSD · Claimable {amount(snap.members[i].credit)}{" "}
                            dUSD
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="native-deadlines">
                    <span>
                      Funding closes{" "}
                      {new Date(
                        Number(pack.quote.fundingDeadline) * 1000,
                      ).toLocaleString()}
                    </span>
                    <span>
                      Capture closes{" "}
                      {new Date(
                        Number(pack.quote.captureDeadline) * 1000,
                      ).toLocaleString()}
                    </span>
                  </div>
                  <section
                    className="native-deadlinetodo"
                    aria-label="Deadline checklist"
                  >
                    <h3>Deadline checklist</h3>
                    <p>
                      {!snap || !quoteVerified || !snapshotFresh
                        ? "Refresh to check which deadline action is due."
                        : agreementNotice(
                            snap.state,
                            snap.now,
                            pack.quote.fundingDeadline,
                            pack.quote.captureDeadline,
                            merchant,
                            snap.credit,
                          )}
                    </p>
                    <button
                      className="native-secondary"
                      onClick={() =>
                        download(
                          deadlineCalendar(
                            pack.id,
                            pack.terms.title,
                            pack.quote.fundingDeadline,
                            pack.quote.captureDeadline,
                          ),
                          "pactpay-deadlines.ics",
                          "text/calendar;charset=utf-8",
                        )
                      }
                    >
                      Save deadlines to my calendar (.ics)
                    </button>
                    <p className="native-footnote">
                      Optional local calendar file. Import it in your calendar
                      app to choose reminders. PactPay sends no external
                      notifications and this file never executes an action.
                    </p>
                  </section>
                  <section
                    className="native-chainstatus"
                    aria-label="Agreement live status"
                  >
                    <p role="status">
                      {readFailed
                        ? "Chain refresh unavailable. Displayed balances may be outdated; payment actions are paused."
                        : snapshotFresh
                          ? "Latest successful chain read: " +
                            new Date(readAt).toLocaleTimeString()
                          : "Refresh this agreement before another payment."}
                    </p>
                    {snap && snapshotFresh && (
                      <p>
                        {agreementNotice(
                          snap.state,
                          snap.now,
                          pack.quote.fundingDeadline,
                          pack.quote.captureDeadline,
                          merchant,
                          snap.credit,
                        )}
                      </p>
                    )}
                    <button
                      className="native-secondary"
                      disabled={busy}
                      onClick={() => void run(() => refresh())}
                    >
                      Refresh agreement
                    </button>
                  </section>
                  {snap && quoteVerified && snapshotFresh && (
                    <div className="native-actions">
                      {snap.share > 0n && (
                        <>
                          <p>
                            Your wallet: {amount(snap.balance)} dUSD · your
                            share: {amount(snap.share)} dUSD
                          </p>
                          <button
                            disabled={
                              blocked ||
                              !selected ||
                              !funding ||
                              snap.contributed > 0n ||
                              snap.allowance >= snap.share
                            }
                            onClick={approve}
                          >
                            1. Approve exact share
                          </button>
                          <button
                            className="native-secondary"
                            disabled={
                              blocked || !selected || snap.allowance === 0n
                            }
                            onClick={revokeApproval}
                          >
                            Revoke token approval
                          </button>
                          <button
                            disabled={
                              blocked ||
                              !selected ||
                              !funding ||
                              snap.share === 0n ||
                              snap.contributed > 0n ||
                              snap.allowance < snap.share ||
                              snap.balance < snap.share
                            }
                            onClick={() =>
                              action(
                                "contribute",
                                "Contribute your fixed share",
                              )
                            }
                          >
                            2. Contribute {amount(snap.share)} dUSD
                          </button>
                          <button
                            className="native-secondary"
                            disabled={
                              blocked || !funding || snap.contributed === 0n
                            }
                            onClick={() =>
                              action(
                                "withdrawContribution",
                                "Withdraw contribution before collection is ready",
                              )
                            }
                          >
                            Withdraw contribution
                          </button>
                        </>
                      )}
                      {merchant && (
                        <>
                          <button
                            disabled={blocked || !ready}
                            onClick={() =>
                              action(
                                "capture",
                                "Capture collection into merchant claimable credit",
                              )
                            }
                          >
                            Capture collection
                          </button>
                          <button
                            className="native-secondary"
                            disabled={blocked || ![1, 2].includes(snap.state)}
                            onClick={() =>
                              action(
                                "cancel",
                                "Cancel agreement and credit members for refunds",
                              )
                            }
                          >
                            Cancel and release refunds
                          </button>
                        </>
                      )}
                      <button
                        disabled={blocked || !selected || snap.credit === 0n}
                        onClick={() =>
                          action(
                            "claim",
                            "Claim " +
                              amount(snap.credit) +
                              " dUSD to your wallet",
                          )
                        }
                      >
                        Claim {amount(snap.credit)} dUSD
                      </button>
                      <button
                        className="native-secondary"
                        disabled={
                          blocked ||
                          !selected ||
                          !(
                            (snap.state === 1 &&
                              snap.now >= pack.quote.fundingDeadline) ||
                            (snap.state === 2 &&
                              snap.now >= pack.quote.captureDeadline)
                          )
                        }
                        onClick={() =>
                          action(
                            "expire",
                            "Expire agreement and release contributor refunds",
                          )
                        }
                      >
                        Process expiry
                      </button>
                    </div>
                  )}
                  <p className="native-footnote">
                    Capture creates merchant credit. Claim transfers tokens.
                    Cancelled or expired contributions become individual
                    refunds.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
        {tab === "create" && (
          <section className="native-panel native-form">
            <span className="native-kicker">FIXED SHARES · 1–5 MEMBERS</span>
            <h2>A clear agreement before anyone pays.</h2>
            <p className="native-muted">
              Draft saved on this browser. No signature or transaction is saved
              in this form.
            </p>
            <button
              className="native-secondary"
              disabled={busy || !!review}
              onClick={clearDraft}
            >
              Clear draft
            </button>
            {!config && (
              <p className="native-alert">
                Set up or import your native deployment first.
              </p>
            )}
            <button
              className="native-secondary"
              disabled={busy || !!review}
              onClick={useWorkshopTemplate}
            >
              Use workshop booking template
            </button>
            <p className="native-footnote">
              The template includes withdrawal, cancellation, expiry and
              delivery terms in the signed agreement description. Add the
              session details before creation.
            </p>
            <label>
              Agreement title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Shared design workshop"
              />
            </label>
            <label>
              Merchant name
              <input
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              What everyone is paying for
              <textarea
                aria-label="What everyone is paying for"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
                rows={3}
              />
            </label>
            <h3>Members and their fixed shares</h3>
            {members.map((m, i) => (
              <div className="native-memberform" key={i}>
                <label>
                  Member {i + 1} native address
                  <input
                    value={m.address}
                    onChange={(e) =>
                      setMembers((old) =>
                        old.map((x, j) =>
                          j === i ? { ...x, address: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="5…"
                  />
                </label>
                <label>
                  Share · dUSD
                  <input
                    value={m.amount}
                    aria-label={`Member ${i + 1} share in dUSD`}
                    inputMode="decimal"
                    onChange={(e) =>
                      setMembers((old) =>
                        old.map((x, j) =>
                          j === i ? { ...x, amount: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  className="native-icon"
                  disabled={members.length === 1}
                  aria-label={"Remove member " + (i + 1)}
                  onClick={() =>
                    setMembers((old) => old.filter((_, j) => j !== i))
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              className="native-secondary"
              disabled={members.length >= 5}
              onClick={() =>
                setMembers((old) => [...old, { address: "", amount: "10" }])
              }
            >
              <Plus size={15} />
              Add member
            </button>
            <div className="native-formrow">
              <label>
                Funding window · hours
                <input
                  value={hours}
                  inputMode="numeric"
                  onChange={(e) => setHours(e.target.value)}
                />
              </label>
              <label>
                Capture window after funding closes · hours
                <input
                  value={captureHours}
                  inputMode="numeric"
                  onChange={(e) => setCaptureHours(e.target.value)}
                />
              </label>
            </div>
            <p className="native-footnote" id="native-creation-help">
              {intent
                ? "A saved transaction must be reconciled before creating another agreement. "
                : !selected
                  ? "Connect Polkadot.js to enable agreement review. "
                  : !config
                    ? "Open Deployment & test funds to set up or import a verified deployment. "
                    : review
                      ? "Finish or cancel the current review first. "
                      : busy
                        ? "Wallet and chain checks are still running. "
                        : health?.ageMs > 180000
                          ? "The chain connection is behind. Refresh it before creating an agreement. "
                          : ""}
              Your native wallet must be the merchant. Creation is authorized by
              your on-chain transaction, without an EIP-712 signature. Connect a
              wallet and set up or import a verified deployment to review
              creation.
            </p>
            <p className="native-alert">
              Original terms will be published permanently on the public chain,
              including the title, description and merchant name. Anyone can
              recover them. Leave out private or sensitive information.
            </p>
            <button
              aria-describedby="native-creation-help"
              disabled={blocked || !selected || !config}
              onClick={createQuote}
            >
              Review agreement creation
              <ArrowRight size={16} />
            </button>
          </section>
        )}
        {tab === "setup" && (
          <div className="native-columns">
            <section className="native-panel">
              <span className="native-kicker">ONE-TIME SETUP</span>
              <h2>Your own payment workspace.</h2>
              {(config || isAddress(token)) && (
                <label>
                  <input
                    type="checkbox"
                    checked={allowNewDeployment}
                    onChange={(e) => setAllowNewDeployment(e.target.checked)}
                  />
                  Intentionally prepare another deployment with a separate
                  storage deposit
                </label>
              )}
              <p>
                Deploy a demo payment asset, then an escrow bound to that asset.
                Each step has a separate cost review and wallet confirmation.
              </p>
              <div className="native-step">
                <span>1</span>
                <div>
                  <h3>Test payment token</h3>
                  <p>
                    {token
                      ? short(token)
                      : "Six-decimal dUSD. No backing or monetary value."}
                  </p>
                  <button
                    disabled={blocked || !selected}
                    onClick={() => prepareDeploy("token")}
                  >
                    Estimate token deployment
                  </button>
                </div>
              </div>
              <div className="native-step">
                <span>2</span>
                <div>
                  <h3>PactPay escrow</h3>
                  <p>
                    Fixed shares, individual refunds and no admin withdrawal.
                  </p>
                  <button
                    disabled={blocked || !selected || !token}
                    onClick={() => prepareDeploy("escrow")}
                  >
                    Estimate escrow deployment
                  </button>
                </div>
              </div>
              <p className="native-footnote">
                Storage deposit may exceed execution fees. The balance alone
                does not establish whether deployment is affordable.
              </p>
              {config && (
                <p className="native-success native-alert">
                  <CheckCircle2 size={16} />
                  Deployment verified: {short(config.contract)}
                </p>
              )}
              <details className="native-import">
                <summary>Import or export deployment</summary>
                <label>
                  Native deployment JSON
                  <textarea
                    aria-label="Native deployment JSON"
                    rows={6}
                    value={configRaw}
                    onChange={(e) => setConfigRaw(e.target.value)}
                  />
                </label>
                <button
                  disabled={blocked || !configRaw}
                  onClick={() =>
                    void run(async () => {
                      const c = JSON.parse(configRaw);
                      await verifyConfig(c);
                      if (pending(localStorage))
                        throw Error(
                          "Reconcile the saved transaction before changing deployment.",
                        );
                      persistWorkspace(c, []);
                      setConfig(c);
                      setPackages([]);
                      setPack(null);
                      setSnap(null);
                      setQuoteVerified(false);
                      setReadAt(0);
                      setToken(c.token);
                      setNotice("Deployment code and token binding verified.");
                    })
                  }
                >
                  Verify deployment
                </button>
                <button
                  className="native-secondary"
                  disabled={!config}
                  onClick={() =>
                    config &&
                    download(json(config), "pactpay-native-deployment.json")
                  }
                >
                  <Download size={15} />
                  Export config
                </button>
              </details>
            </section>
            <section className="native-panel">
              <span className="native-kicker">PUBLIC TEST FUNDS ONLY</span>
              <h2>Try a payment with dUSD.</h2>
              <p>
                The test token owner can mint demo funds to a mapped native
                account. Minting requires native gas; dUSD cannot pay that fee.
              </p>
              <label>
                Recipient native address
                <input
                  value={mintTo}
                  onChange={(e) => setMintTo(e.target.value)}
                  placeholder="5…"
                />
              </label>
              <label>
                Amount · dUSD
                <input
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <button disabled={blocked || !selected || !config} onClick={mint}>
                Review demo mint
              </button>
              <div className="native-note">
                <ShieldCheck size={22} />
                <div>
                  <strong>Signing stays in Polkadot.js.</strong>
                  <p>
                    No seed phrase or private key is entered into PactPay.
                    Native funds stay in your native account until you authorize
                    a transaction.
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}
        {config && pack && (
          <AttendancePanel
            key={pack.id}
            quote={pack}
            account={selected || undefined}
          />
        )}
        {config && (
          <OrderEvidence
            onEvidence={receiveEvidence}
            config={config}
            account={info?.h160}
            quote={pack}
            onRecover={(raw) =>
              importWorkspace(createTransferBundle("agreement", config, [raw]))
            }
            onSelect={(id) => {
              if (pack?.id === id) {
                setTab("agreements");
                void run(() => refresh());
                return;
              }
              const raw = packages.find((value) => {
                try {
                  return JSON.parse(value).id === id;
                } catch {
                  return false;
                }
              });
              if (raw) {
                setPack(parseNativePackage(raw, config));
                setSnap(null);
                setQuoteVerified(false);
                setTab("agreements");
              } else
                setNotice(
                  "This on-chain order needs its merchant’s agreement file to show and verify the human-readable terms. Import that file to open checkout.",
                );
            }}
          />
        )}
        <WorkspaceTransfer
          config={config}
          quote={pack}
          packages={packages}
          blocked={blocked}
          onImport={importWorkspace}
        />
        <footer className="native-footer">
          <span>
            Native signatures · verified mapping · finalized chain state
          </span>
          <span>Testnet prototype · independent audit pending</span>
        </footer>
      </main>
      {review && (
        <Dialog.Root
          open
          onOpenChange={(v) => {
            if (!v && !busy) setReview(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="native-overlay" />
            <Dialog.Content
              className="native-review native-reviewportal"
              onCloseAutoFocus={(event) => {
                if (reviewTrigger.current?.isConnected) {
                  event.preventDefault();
                  reviewTrigger.current.focus();
                }
              }}
            >
              <p className="native-eyebrow">REVIEW BEFORE SIGNING</p>
              <Dialog.Title>{review.label}</Dialog.Title>
              <Dialog.Description>
                Review the native transaction before opening Polkadot.js.
              </Dialog.Description>
              <dl>
                <dt>Network</dt>
                <dd>Portaldot V3 Testnet · 420420777</dd>
                <dt>Signer</dt>
                <dd>{review.account}</dd>
                {review.target && (
                  <>
                    <dt>Contract receiving the call</dt>
                    <dd>{review.target}</dd>
                  </>
                )}
                <dt>Estimated network fee</dt>
                <dd>{native(BigInt(review.tx.fee || 0))} tPOT</dd>
                <dt>Storage deposit limit</dt>
                <dd>{native(BigInt(review.tx.storageDeposit || 0))} tPOT</dd>
                <dt>Native funds required for this step</dt>
                <dd>
                  {native(
                    BigInt(review.tx.fee || 0) +
                      BigInt(review.tx.storageDeposit || 0),
                  )}{" "}
                  tPOT
                </dd>
                <dt>Fee and storage payer</dt>
                <dd>{review.account}</dd>
                {review.tx.predictedContract && (
                  <>
                    <dt>Expected contract</dt>
                    <dd>{review.tx.predictedContract}</dd>
                  </>
                )}
              </dl>
              {review.draft && (
                <div className="native-reviewterms">
                  <p className="native-alert">
                    Signing publishes these original terms permanently and
                    publicly on-chain. Anyone can recover the title, description
                    and merchant name.
                  </p>
                  <h3>{review.draft.terms.title}</h3>
                  <p>{review.draft.terms.description}</p>
                  <p>
                    Total {amount(review.draft.quote.total)} dUSD ·{" "}
                    {review.draft.members.length} fixed shares
                  </p>
                  <ul>
                    {review.draft.members.map((m: string, i: number) => (
                      <li key={m}>
                        {short(m)}: {amount(review.draft.shares[i])} dUSD
                      </li>
                    ))}
                  </ul>
                  <p>
                    Funding closes{" "}
                    {deadlineText(review.draft.quote.fundingDeadline)}
                    <br />
                    Capture closes{" "}
                    {deadlineText(review.draft.quote.captureDeadline)}
                  </p>
                </div>
              )}
              <p>
                dUSD is the demo payment asset. Native tPOT covers network fees
                and storage. Later transactions require separate estimates;
                their costs are not included in this step. Storage recovery is
                not guaranteed by this review.
              </p>
              <CostSummary
                tx={review.tx}
                spendable={BigInt(info?.spendable ?? 0)}
              />
              <p>
                The wallet shows the final request. A storage deposit is
                distinct from the network fee. Stop if the account, network or
                action differs.
              </p>
              <div className="native-reviewactions">
                <button
                  className="native-secondary"
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  Cancel
                </button>
                <button
                  disabled={
                    busy ||
                    !!intent ||
                    review.account !== selected ||
                    health?.ageMs > 180000
                  }
                  onClick={confirm}
                >
                  <Wallet size={16} />
                  Confirm in Polkadot.js
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {busy && (
        <div className="native-working" role="status">
          <RefreshCw size={16} />
          Checking wallet and chain…
        </div>
      )}
    </div>
  );
}
