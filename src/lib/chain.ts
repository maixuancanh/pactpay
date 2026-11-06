import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  defineChain,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

export const localChain = defineChain({
  id: 31337,
  name: "PactPay local chain",
  nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const v3Chain = defineChain({
  id: 420420777,
  name: "Portaldot V3 Testnet",
  nativeCurrency: { name: "tPOTv3", symbol: "tPOTv3", decimals: 18 },
  rpcUrls: { default: { http: ["https://test-evm-rpc-v3.portaldot.dev"] } },
});

export type Deployment = {
  mode: "local" | "testnet";
  chainId: number;
  contract: Address;
  token: Address;
  accounts: Address[];
  blockNumber: string;
  codeHash: Hex;
};

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
]);

export function publicClient(d: Deployment) {
  return createPublicClient({
    chain: d.chainId === 31337 ? localChain : v3Chain,
    transport: http(
      d.chainId === 31337
        ? "http://127.0.0.1:8545"
        : "https://test-evm-rpc-v3.portaldot.dev",
      { timeout: 15000 },
    ),
  });
}

export function walletClient(d: Deployment, account: Address, mode: "demo" | "wallet" = "wallet") {
  if (mode === "demo" && d.mode === "local")
    return createWalletClient({
      account,
      chain: localChain,
      transport: http("http://127.0.0.1:8545"),
    });
  const eth = (window as any).ethereum;
  if (!eth) throw Error("Install an EVM wallet to use testnet.");
  return createWalletClient({
    account,
    chain: d.chainId === 31337 ? localChain : v3Chain,
    transport: custom(eth),
  });
}

export const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-4);
