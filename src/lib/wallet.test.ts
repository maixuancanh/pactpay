import { describe, it, expect } from "vitest";
import {
  requireWalletContext,
  requireWalletDeployment,
  firstWalletAccount,
  walletErrorMessage,
  switchOrAddWalletChain,
} from "./wallet";
import { v3Chain } from "./chain";
const member = "0x3000000000000000000000000000000000000000";
describe("wallet network registration", () => {
  it.each([
    { code: 4902 },
    { code: -32603, data: { originalError: { code: 4902 } } },
  ])("adds the official chain only after unknown-chain error %j", async (error) => {
    const calls: any[] = [];
    await switchOrAddWalletChain({ request: async (args) => {
      calls.push(args);
      if (calls.length === 1) throw error;
    } }, v3Chain);
    expect(calls.map(x => x.method)).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
    expect(calls[1].params[0]).toEqual({ chainId: "0x190f1ca9", chainName: v3Chain.name,
      nativeCurrency: v3Chain.nativeCurrency, rpcUrls: [...v3Chain.rpcUrls.default.http] });
  });
  it("does not add a chain after rejected or unrelated requests", async () => {
    for (const error of [{ code: 4001, data: { originalError: { code: 4902 } } }, { code: -32000 }]) {
      const calls: string[] = [];
      await expect(switchOrAddWalletChain({ request: async ({method}) => { calls.push(method); throw error; } }, v3Chain)).rejects.toBe(error);
      expect(calls).toEqual(["wallet_switchEthereumChain"]);
    }
  });
  it("does not prompt switch again when adding the network is rejected", async () => {
    const calls: string[] = [];
    await expect(switchOrAddWalletChain({ request: async ({method}) => {
      calls.push(method); throw { code: calls.length === 1 ? 4902 : 4001 };
    } }, v3Chain)).rejects.toMatchObject({ code: 4001 });
    expect(calls).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain"]);
  });
});
describe("injected wallet authority", () => {
  it("rejects account changed between render and signing", async () => {
    const provider = {
      request: async ({ method }: { method: string }) =>
        method === "eth_accounts"
          ? ["0x4000000000000000000000000000000000000000"]
          : "0x7a69",
    };
    await expect(requireWalletContext(provider, member, 31337)).rejects.toThrow(
      "account changed",
    );
  });
  it("rejects wrong chain before any write", async () => {
    const p = {
      request: async ({ method }: { method: string }) =>
        method === "eth_accounts" ? [member] : "0x1",
    };
    await expect(requireWalletContext(p, member, 31337)).rejects.toThrow(
      "network",
    );
  });
  it("rejects disconnected wallets and accepts matching authority", async () => {
    expect(firstWalletAccount([])).eq(null);
    expect(firstWalletAccount(["bad"])).eq(null);
    const p = {
      request: async ({ method }: { method: string }) =>
        method === "eth_accounts" ? [member] : "0x7a69",
    };
    await expect(
      requireWalletContext(p, member, 31337),
    ).resolves.toBeUndefined();
  });
  it("explains rejection without claiming a transfer", () => {
    expect(walletErrorMessage({ code: 4001 })).toContain(
      "No transaction was submitted",
    );
  });
});

it("blocks a different RPC deployment even when the network ID matches", async () => {
  const { keccak256 } = await import("viem");
  const hash = keccak256("0x1234");
  await expect(
    requireWalletDeployment({ request: async () => "0x" }, member, hash),
  ).rejects.toThrow("different deployment");
  await expect(
    requireWalletDeployment({ request: async () => "0x5678" }, member, hash),
  ).rejects.toThrow("different deployment");
  await expect(
    requireWalletDeployment({ request: async () => "0x1234" }, member, hash),
  ).resolves.toBeUndefined();
});
