import { useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  encodeDeployData,
  encodeFunctionData,
  parseAbi,
  parseUnits,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { localChain, v3Chain, type Deployment } from "./lib/chain";
import { requireWalletContext, walletErrorMessage, switchOrAddWalletChain } from "./lib/wallet";
import { explicitlyRejected } from "./lib/transactions";
const bindingAbi = parseAbi(["function token() view returns(address)"]);
const assetAbi = parseAbi([
  "function decimals() view returns(uint8)",
  "function owner() view returns(address)",
  "function mint(address,uint256)",
]);
type Intent = {
  name: string;
  chainId: number;
  from: Address;
  data: Hex;
  nonce: number;
  hash?: Hex;
  token?: Address;
  to?: Address;
};
const progressKey = (chain: number) => `pactpay.setup.progress:${chain}`;
const intentKey = (chain: number) => `pactpay.setup.intent:${chain}`;
export default function Setup() {
  const [chainId, setChainId] = useState(420420777),
    [account, setAccount] = useState<Address | null>(null),
    [token, setToken] = useState<Address | null>(null),
    [contract, setContract] = useState<Address | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<{
      name: string;
      gas: bigint;
      fee: bigint;
      data: Hex;
    } | null>(null),
    [config, setConfig] = useState<Deployment | null>(null),
    [raw, setRaw] = useState(""),
    [pending, setPending] = useState<Intent | null>(null),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState("1000");
  const chain = chainId === 31337 ? localChain : v3Chain,
    client = createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    });
  useEffect(() => {
    setToken(null);
    setContract(null);
    setConfig(null);
    setReview(null);
    try {
      const p = JSON.parse(
        localStorage.getItem(progressKey(chainId)) || "null",
      );
      if (p) {
        setToken(p.token || null);
        setContract(p.contract || null);
        setConfig(p.config || null);
      }
      setPending(
        JSON.parse(localStorage.getItem(intentKey(chainId)) || "null"),
      );
    } catch {
      setNotice(
        "Saved setup could not be read. Import a verified configuration.",
      );
    }
  }, [chainId]);
  useEffect(() => {
    const e = (window as any).ethereum;
    if (!e) return;
    const changed = (xs: any) => {
      setAccount(Array.isArray(xs) ? xs[0] || null : null);
      setReview(null);
    };
    const network = () => {
      setReview(null);
      setNotice(
        "Wallet network changed. Review the deployment network before signing.",
      );
    };
    e.on?.("accountsChanged", changed);
    e.on?.("chainChanged", network);
    e.on?.("disconnect", network);
    return () => {
      e.removeListener?.("accountsChanged", changed);
      e.removeListener?.("chainChanged", network);
      e.removeListener?.("disconnect", network);
    };
  }, []);
  async function networkGuard() {
    if (!account) throw Error("Connect your wallet first.");
    const eth = (window as any).ethereum;
    await requireWalletContext(eth, account, chain.id);
    const pubHeight = await client.getBlockNumber();
    const walletHeight = BigInt(
      await eth.request({ method: "eth_blockNumber" }),
    );
    const height = pubHeight < walletHeight ? pubHeight : walletHeight;
    const [a, b] = await Promise.all([
      client.getBlock({ blockNumber: height }),
      eth.request({
        method: "eth_getBlockByNumber",
        params: ["0x" + height.toString(16), false],
      }),
    ]);
    if (!b?.hash || a.hash?.toLowerCase() !== b.hash.toLowerCase())
      throw Error(
        "Wallet RPC differs from selected deployment network. Check its RPC address, not only the chain ID.",
      );
  }
  async function connect() {
    try {
      if (!(window as any).ethereum)
        throw Error(
          "Install a browser EVM wallet. No private key is requested.",
        );
      const eth = (window as any).ethereum;
      setAccount((await eth.request({ method: "eth_requestAccounts" }))[0]);
      setNotice("Wallet connected. Review each deployment separately.");
    } catch (e) {
      setNotice(walletErrorMessage(e));
    }
  }
  async function switchNetwork() {
    try {
      await switchOrAddWalletChain((window as any).ethereum, chain);
      setNotice("Wallet switched to selected deployment network.");
    } catch (e) {
      setNotice(walletErrorMessage(e));
    }
  }
  async function verified(d: any): Promise<Deployment> {
    if (
      ![31337, 420420777].includes(d.chainId) ||
      !isAddress(d.contract) ||
      !isAddress(d.token) ||
      !/^0x[0-9a-f]{64}$/i.test(d.codeHash)
    )
      throw Error("Invalid deployment configuration.");
    const c = d.chainId === 31337 ? localChain : v3Chain,
      p = createPublicClient({
        chain: c,
        transport: http(c.rpcUrls.default.http[0]),
      });
    if ((await p.getChainId()) !== d.chainId)
      throw Error("RPC network mismatch.");
    const code = await p.getCode({ address: d.contract });
    if (!code || code === "0x" || keccak256(code) !== d.codeHash)
      throw Error("Configuration contract code does not match chain.");
    const bound = await p.readContract({
      address: d.contract,
      abi: bindingAbi,
      functionName: "token",
    });
    if (bound.toLowerCase() !== d.token.toLowerCase())
      throw Error("Escrow uses a different token.");
    if (
      (await p.readContract({
        address: d.token,
        abi: assetAbi,
        functionName: "decimals",
      })) !== 6
    )
      throw Error("This workspace requires the 6-decimal demo token.");
    return {
      ...d,
      accounts: [],
      mode: d.chainId === 31337 ? "local" : "testnet",
      blockNumber: String(d.blockNumber || 0),
    };
  }
  async function finish(intent: Intent, hash: Hex) {
    const r = await client.getTransactionReceipt({ hash });
    if (r.status !== "success") {
      localStorage.removeItem(intentKey(chainId));
      setPending(null);
      throw Error("Deployment reverted. No contract installed.");
    }
    if (intent.name === "Mint") {
      localStorage.removeItem(intentKey(chainId));
      setPending(null);
      setReview(null);
      setNotice(
        `Test tokens minted. Receipt ${hash}. These have no monetary value.`,
      );
      return;
    }
    if (!r.contractAddress) throw Error("No contract address in receipt.");
    const code = await client.getCode({ address: r.contractAddress });
    if (!code || code === "0x") throw Error("No deployed bytecode.");
    let nextToken = token,
      nextContract = contract,
      nextConfig = config;
    if (intent.name === "DemoUSD") {
      if (
        (await client.readContract({
          address: r.contractAddress,
          abi: assetAbi,
          functionName: "decimals",
        })) !== 6
      )
        throw Error("Unexpected token decimals.");
      nextToken = r.contractAddress;
      setToken(nextToken);
    } else {
      nextToken = intent.token!;
      nextContract = r.contractAddress;
      nextConfig = await verified({
        chainId,
        contract: nextContract,
        token: nextToken,
        blockNumber: String(r.blockNumber),
        codeHash: keccak256(code),
      });
      setToken(nextToken);
      setContract(nextContract);
      setConfig(nextConfig);
      localStorage.setItem(
        "pactpay.deployment.override",
        JSON.stringify(nextConfig),
      );
      localStorage.removeItem("pactpay.last-open-package");
    }
    localStorage.setItem(
      progressKey(chainId),
      JSON.stringify({
        token: nextToken,
        contract: nextContract,
        config: nextConfig,
      }),
    );
    localStorage.removeItem(intentKey(chainId));
    setPending(null);
    setReview(null);
    setNotice(
      `${intent.name} deployed and read back. Receipt ${hash}. Application workflows still need separate verification.`,
    );
  }
  async function preflight(name: string) {
    setBusy(true);
    setReview(null);
    try {
      if (pending)
        throw Error("Resolve the saved deployment before creating another.");
      if (!account) throw Error("Connect your wallet first.");
      await networkGuard();
      const a = await (await fetch(`/deploy-artifacts/${name}.json`)).json();
      if (!a.bytecode || a.bytecode === "0x")
        throw Error("Browser build artifacts unavailable.");
      if (name === "PactPay" && !token)
        throw Error("Deploy the test token first.");
      if (
        token &&
        name === "PactPay" &&
        (await client.getCode({ address: token })) === "0x"
      )
        throw Error(
          "Saved token is absent on this chain. Import the correct deployment.",
        );
      const data = encodeDeployData({
        abi: a.abi,
        bytecode: a.bytecode,
        args: name === "PactPay" ? [token] : [],
      });
      const gas = await client.estimateGas({ account, data }),
        fee = await client.getGasPrice();
      setReview({ name, gas: (gas * 120n) / 100n, fee, data });
    } catch (e) {
      setNotice(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function deploy() {
    if (!review || !account || pending) return;
    setBusy(true);
    try {
      await networkGuard();
      const intent: Intent = {
        name: review.name,
        chainId,
        from: account,
        data: review.data,
        nonce: await client.getTransactionCount({
          address: account,
          blockTag: "pending",
        }),
        token: token || undefined,
      };
      localStorage.setItem(intentKey(chainId), JSON.stringify(intent));
      setPending(intent);
      let hash: Hex;
      try {
        hash = await createWalletClient({
          account,
          chain,
          transport: custom((window as any).ethereum),
        }).sendTransaction({
          data: review.data,
          gas: review.gas,
          nonce: intent.nonce,
        });
      } catch (e) {
        if (explicitlyRejected(e)) {
          localStorage.removeItem(intentKey(chainId));
          setPending(null);
        }
        throw e;
      }
      const saved = { ...intent, hash };
      localStorage.setItem(intentKey(chainId), JSON.stringify(saved));
      setPending(saved);
      setNotice(
        `Deployment submitted ${hash}. Wait or use Check saved deployment; do not deploy again.`,
      );
      await client.waitForTransactionReceipt({ hash, timeout: 60000 });
      await finish(saved, hash);
    } catch (e) {
      setNotice(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    try {
      let hash = pending.hash;
      if (!hash) {
        const end = await client.getBlockNumber(),
          start = end > 80n ? end - 80n : 0n;
        for (let n = start; n <= end && !hash; n++) {
          const b = await client.getBlock({
            blockNumber: n,
            includeTransactions: true,
          });
          const t = b.transactions.find(
            (x: any) =>
              typeof x === "object" &&
              x.from.toLowerCase() === pending.from.toLowerCase() &&
              x.nonce === pending.nonce &&
              (pending.to
                ? x.to?.toLowerCase() === pending.to.toLowerCase()
                : !x.to) &&
              x.input === pending.data,
          );
          if (t && typeof t === "object") hash = t.hash;
        }
      }
      if (!hash)
        throw Error(
          "No matching deployment found in recent blocks. Inspect wallet activity; no transaction was resent.",
        );
      await finish(pending, hash);
    } catch (e) {
      setNotice(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function importConfig() {
    setBusy(true);
    try {
      const d = await verified(JSON.parse(raw));
      localStorage.setItem("pactpay.deployment.override", JSON.stringify(d));
      localStorage.removeItem("pactpay.last-open-package");
      localStorage.setItem(
        progressKey(d.chainId),
        JSON.stringify({ token: d.token, contract: d.contract, config: d }),
      );
      setChainId(d.chainId);
      setConfig(d);
      setToken(d.token);
      setContract(d.contract);
      setNotice(
        "Deployment code, token binding and decimals verified. Open workspace to create a quote.",
      );
    } catch (e) {
      setNotice(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function mint() {
    setBusy(true);
    try {
      if (pending) throw Error("Resolve saved transaction first.");
      if (!account || !token || !isAddress(recipient))
        throw Error("Connect token owner and enter a recipient wallet.");
      const n = parseUnits(amount, 6);
      if (n <= 0n || n > parseUnits("1000000", 6))
        throw Error("Enter between 0 and 1,000,000 test tokens per mint.");
      await networkGuard();
      const eth = (window as any).ethereum;
      const [actualCode, expectedCode] = await Promise.all([
        eth.request({ method: "eth_getCode", params: [token, "latest"] }),
        client.getCode({ address: token }),
      ]);
      if (!expectedCode || expectedCode === "0x" || actualCode !== expectedCode)
        throw Error("Wallet RPC token deployment mismatch.");
      if (
        (
          await client.readContract({
            address: token,
            abi: assetAbi,
            functionName: "owner",
          })
        ).toLowerCase() !== account.toLowerCase()
      )
        throw Error("Only demo token owner can mint.");
      const args = [recipient, n] as const;
      await client.simulateContract({
        account,
        address: token,
        abi: assetAbi,
        functionName: "mint",
        args,
      });
      const gas = await client.estimateContractGas({
        account,
        address: token,
        abi: assetAbi,
        functionName: "mint",
        args,
      });
      const intent: Intent = {
        name: "Mint",
        chainId,
        from: account,
        to: token,
        data: encodeFunctionData({ abi: assetAbi, functionName: "mint", args }),
        nonce: await client.getTransactionCount({
          address: account,
          blockTag: "pending",
        }),
        token,
      };
      localStorage.setItem(intentKey(chainId), JSON.stringify(intent));
      setPending(intent);
      let hash: Hex;
      try {
        hash = await createWalletClient({
          account,
          chain,
          transport: custom(eth),
        }).sendTransaction({
          to: token,
          data: intent.data,
          nonce: intent.nonce,
          gas: gas + gas / 5n,
        });
      } catch (e) {
        if (explicitlyRejected(e)) {
          localStorage.removeItem(intentKey(chainId));
          setPending(null);
        }
        throw e;
      }
      const saved = { ...intent, hash };
      localStorage.setItem(intentKey(chainId), JSON.stringify(saved));
      setPending(saved);
      await client.waitForTransactionReceipt({ hash });
      await finish(saved, hash);
    } catch (e) {
      setNotice(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!config) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }),
    );
    a.download = "pactpay-deployment.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <main className="setup-page">
      <a href="/">← PactPay workspace</a>
      <a href="/native">Use Polkadot.js native wallet →</a>
      <h1>Set up your deployment</h1>
      <p>
        Use your browser wallet. Two contracts, two separate confirmations. Test
        tokens have no backing or monetary value.
      </p>
      <label>
        Network
        <select
          aria-label="Deployment network"
          value={chainId}
          disabled={busy}
          onChange={(e) => setChainId(Number(e.target.value))}
        >
          <option value={420420777}>Portaldot V3 testnet</option>
          <option value={31337}>Local verification chain</option>
        </select>
      </label>
      <button className="primary" onClick={connect} disabled={busy}>
        {account ? "Wallet connected" : "Connect deployment wallet"}
      </button>
      <button onClick={switchNetwork} disabled={busy || !account}>
        Switch wallet network
      </button>
      <p className="breakall">{account || "No wallet connected"}</p>
      <p>
        Chain {chainId}. Gas is paid by your wallet; this page never receives
        your private key.
      </p>
      {pending && (
        <section className="card" aria-label="Saved deployment">
          <h2>Deployment outcome needs checking</h2>
          <p>
            {pending.name}:{" "}
            {pending.hash || "Wallet response did not include a hash."}
          </p>
          <button onClick={recover} disabled={busy}>
            Check saved deployment
          </button>
          <p>
            Sending another deployment is blocked until this intent is resolved.
          </p>
        </section>
      )}
      <section className="card">
        <h2>1. Test payment token</h2>
        {token ? (
          <code>{token}</code>
        ) : (
          <button
            disabled={busy || !account || !!pending}
            onClick={() => preflight("DemoUSD")}
          >
            Estimate token deployment
          </button>
        )}
      </section>
      <section className="card">
        <h2>2. Collection escrow</h2>
        {contract ? (
          <code>{contract}</code>
        ) : (
          <button
            disabled={busy || !account || !token || !!pending}
            onClick={() => preflight("PactPay")}
          >
            Estimate PactPay deployment
          </button>
        )}
      </section>
      {review && (
        <section className="card" aria-label="Deployment review">
          <h2>Review {review.name}</h2>
          <p>
            Chain {chain.id}. Sender {account}. Estimated gas limit with margin:{" "}
            {review.gas.toString()}. Gas price {review.fee.toString()} base
            units.
          </p>
          <p>
            Estimated network cost: {(review.gas * review.fee).toString()} base
            units. Runtime deposits may differ; only wallet signing submits
            deployment.
          </p>
          <button className="primary" disabled={busy} onClick={deploy}>
            Deploy {review.name} with wallet
          </button>
          <button disabled={busy} onClick={() => setReview(null)}>
            Cancel review
          </button>
        </section>
      )}
      <p role="status">{notice}</p>
      {config && (
        <section className="card">
          <h2>Deployment configuration</h2>
          <textarea
            readOnly
            aria-label="Verified deployment JSON"
            value={JSON.stringify(config, null, 2)}
            rows={10}
          />
          <button onClick={download}>Download deployment configuration</button>
          <a className="primary" href="/">
            Open workspace
          </a>
        </section>
      )}
      {token && (
        <section className="card">
          <h2>3. Fund test participants</h2>
          <p>
            Only the owner of this demo token can mint. Review the recipient and
            amount before signing.
          </p>
          <label>
            Test token recipient
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <label>
            Test token amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <button onClick={mint} disabled={busy || !account}>
            Mint test tokens with wallet
          </button>
        </section>
      )}
      <section className="card">
        <h2>Import an existing deployment</h2>
        <label>
          Deployment JSON
          <textarea
            rows={7}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </label>
        <button disabled={busy || !raw} onClick={importConfig}>
          Verify and use configuration
        </button>
        <button
          onClick={() => {
            localStorage.removeItem("pactpay.deployment.override");
            setNotice(
              "Bundled configuration selected for next workspace load.",
            );
          }}
        >
          Use bundled configuration
        </button>
      </section>
      <p>
        Compiler compatibility still needs a V3 canary; local success alone is
        insufficient.
      </p>
    </main>
  );
}
