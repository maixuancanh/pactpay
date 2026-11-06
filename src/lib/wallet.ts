import { isAddress, keccak256, type Address, type Hex, type Chain } from "viem";
export type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, fn: (data: any) => void) => void;
  removeListener?: (event: string, fn: (data: any) => void) => void;
};
export function injectedProvider(): InjectedProvider | null {
  return (window as any).ethereum || null;
}
function hasWalletErrorCode(error: unknown, code: number) {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let i = 0; queue.length && i < 32; i++) {
    const e: any = queue.shift();
    if (!e || typeof e !== "object" || seen.has(e)) continue;
    seen.add(e);
    if (Number(e.code) === code) return true;
    for (const key of ["cause", "data", "originalError", "error"])
      if (e[key]) queue.push(e[key]);
  }
  return false;
}
export async function switchOrAddWalletChain(provider: InjectedProvider, chain: Chain) {
  const params = [{ chainId: "0x" + chain.id.toString(16) }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (e) {
    // A denied request must never trigger a second wallet prompt.
    if (hasWalletErrorCode(e, 4001) || !hasWalletErrorCode(e, 4902)) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ ...params[0], chainName: chain.name, nativeCurrency: chain.nativeCurrency,
        rpcUrls: [...chain.rpcUrls.default.http] }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params });
  }
}
export function firstWalletAccount(accounts: unknown): Address | null {
  return Array.isArray(accounts) &&
    typeof accounts[0] === "string" &&
    isAddress(accounts[0])
    ? accounts[0]
    : null;
}
export async function requireWalletContext(
  provider: InjectedProvider,
  expectedAccount: Address,
  expectedChain: number,
) {
  const accounts = await provider.request({ method: "eth_accounts" });
  const actual = firstWalletAccount(accounts);
  if (!actual || actual.toLowerCase() !== expectedAccount.toLowerCase())
    throw Error(
      "Your wallet account changed. Review the agreement with the current account before signing.",
    );
  const chainId = await provider.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) !== expectedChain)
    throw Error(
      "Your wallet is on another network. Switch to this agreement’s network before signing.",
    );
}
export function walletErrorMessage(error: unknown) {
  const e = error as any;
  let cause = e;
  for (let i = 0; i < 6 && cause; i++, cause = cause.cause) {
    if (cause.code === 4001)
      return "You declined the wallet request. No transaction was submitted.";
    if (cause.code === -32002)
      return "A wallet request is already open. Check your wallet to continue.";
  }
  return (e?.shortMessage || e?.message || String(e)).slice(0, 400);
}

export async function requireWalletDeployment(
  provider: InjectedProvider,
  contract: Address,
  expectedCodeHash: Hex,
) {
  const code = await provider.request({
    method: "eth_getCode",
    params: [contract, "latest"],
  });
  if (
    typeof code !== "string" ||
    code === "0x" ||
    keccak256(code as Hex) !== expectedCodeHash
  )
    throw Error(
      "Your wallet points to a different deployment. Check its RPC endpoint as well as the network ID before signing.",
    );
}
