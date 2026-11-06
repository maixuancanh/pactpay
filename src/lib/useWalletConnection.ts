import { useEffect, useState } from "react";
import type { Address } from "viem";
import { localChain, v3Chain, type Deployment } from "./chain";
import {
  firstWalletAccount,
  injectedProvider,
  requireWalletContext,
  requireWalletDeployment,
  switchOrAddWalletChain,
} from "./wallet";
const MODE = "pactpay.connection-mode";
const CONNECTED = "pactpay.wallet-connected";
export function useWalletConnection(deployment: Deployment | null) {
  const [mode, setMode] = useState<"demo" | "wallet">(() =>
    localStorage.getItem(MODE) === "demo" ? "demo" : "wallet",
  );
  const [walletAccount, setWalletAccount] = useState<Address | null>(null),
    [demoAccount, setDemoAccount] = useState<Address | null>(null),
    [chainId, setChainId] = useState<number | null>(null),
    [connecting, setConnecting] = useState(false),
    [message, setMessage] = useState("");
  const account =
    mode === "demo" &&
    deployment?.mode === "local" &&
    deployment.accounts.length > 0
      ? demoAccount
      : mode === "wallet"
        ? walletAccount
        : null;
  useEffect(() => {
    if (
      deployment?.mode === "local" &&
      deployment.accounts.length > 0 &&
      !demoAccount
    )
      setDemoAccount(deployment.accounts[3] || deployment.accounts[0]);
    if (
      deployment &&
      (deployment.mode === "testnet" || deployment.accounts.length === 0) &&
      mode === "demo"
    ) {
      setMode("wallet");
      localStorage.setItem(MODE, "wallet");
    }
  }, [deployment]);
  useEffect(() => {
    const eth = injectedProvider();
    if (!eth) return;
    let active = true;
    const accountsChanged = (accounts: unknown) => {
      if (localStorage.getItem(CONNECTED) !== "true") return;
      const a = firstWalletAccount(accounts);
      setWalletAccount(a);
      setMessage(
        a
          ? "Wallet account changed. Review your role and contribution before signing."
          : "Wallet disconnected. You can still view the agreement.",
      );
      if (!a) localStorage.removeItem(CONNECTED);
    };
    const chainChanged = (id: string) => {
      setChainId(parseInt(id, 16));
      setMessage(
        "Wallet network changed. Check the network before continuing.",
      );
    };
    const disconnected = () => {
      setWalletAccount(null);
      setChainId(null);
      localStorage.removeItem(CONNECTED);
      setMessage("Wallet disconnected. Reconnect when you are ready.");
    };
    eth.on?.("accountsChanged", accountsChanged);
    eth.on?.("chainChanged", chainChanged);
    eth.on?.("disconnect", disconnected);
    if (localStorage.getItem(CONNECTED) === "true")
      Promise.all([
        eth.request({ method: "eth_accounts" }),
        eth.request({ method: "eth_chainId" }),
      ])
        .then(([accounts, id]) => {
          if (active) {
            setWalletAccount(firstWalletAccount(accounts));
            setChainId(parseInt(id, 16));
          }
        })
        .catch(() => {
          if (active) disconnected();
        });
    return () => {
      active = false;
      eth.removeListener?.("accountsChanged", accountsChanged);
      eth.removeListener?.("chainChanged", chainChanged);
      eth.removeListener?.("disconnect", disconnected);
    };
  }, []);
  async function connect() {
    setMode("wallet");
    localStorage.setItem(MODE, "wallet");
    setConnecting(true);
    setMessage("");
    try {
      const eth = injectedProvider();
      if (!eth)
        throw Error(
          "No wallet found. Install an EVM wallet, or choose Try local demo to explore without one.",
        );
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      const a = firstWalletAccount(accounts);
      if (!a)
        throw Error(
          "No account was shared. Open your wallet and connect an account.",
        );
      const id = await eth.request({ method: "eth_chainId" });
      setWalletAccount(a);
      setChainId(parseInt(id, 16));
      localStorage.setItem(CONNECTED, "true");
      setMessage(
        "Wallet connected. Your account determines which actions are available.",
      );
    } catch (e) {
      setWalletAccount(null);
      localStorage.removeItem(CONNECTED);
      throw e;
    } finally {
      setConnecting(false);
    }
  }
  function disconnect() {
    setWalletAccount(null);
    setMode("wallet");
    localStorage.setItem(MODE, "wallet");
    localStorage.removeItem(CONNECTED);
    setMessage(
      "Disconnected from PactPay. Your wallet permissions can also be managed in your wallet.",
    );
  }
  function enterDemo() {
    if (deployment?.mode !== "local" || !deployment.accounts.length) return;
    setMode("demo");
    localStorage.setItem(MODE, "demo");
    setDemoAccount(deployment.accounts[3] || deployment.accounts[0]);
    setMessage(
      "Local demo selected. Actions use local test accounts, not your connected wallet.",
    );
  }
  async function switchNetwork() {
    if (!deployment) return;
    const eth = injectedProvider();
    if (!eth) throw Error("No wallet found. Connect an EVM wallet first.");
    const chain = deployment.chainId === 31337 ? localChain : v3Chain;
    await switchOrAddWalletChain(eth, chain);
    setChainId(parseInt(await eth.request({ method: "eth_chainId" }), 16));
  }
  async function guard() {
    if (mode === "demo") {
      if (deployment?.mode !== "local" || !account)
        throw Error("Choose a local demo role first.");
      return;
    }
    const eth = injectedProvider();
    if (!eth || !account || !deployment)
      throw Error("Connect your wallet first.");
    await requireWalletContext(eth, account, deployment.chainId);
    await requireWalletDeployment(
      eth,
      deployment.contract,
      deployment.codeHash,
    );
  }
  return {
    mode,
    account,
    chainId,
    connecting,
    message,
    connect,
    disconnect,
    enterDemo,
    switchNetwork,
    guard,
    setDemoAccount,
    wrongNetwork:
      mode === "wallet" &&
      !!walletAccount &&
      !!deployment &&
      chainId !== deployment.chainId,
  };
}
