import { test, expect } from "@playwright/test";
import fs from "node:fs";
async function installWallet(page: any, account: string) {
  await page.addInitScript(
    ({ initial }: { initial: string }) => {
      const listeners: Record<string, Function[]> = {};
      let selected = initial,
        chain = "0x7a69",
        reject = false,
        badRPC = false,
        hold = false,
        lost = false;
      let lastHash = "";
      const calls: string[] = [];
      const emit = (name: string, data: any) =>
        (listeners[name] || []).forEach((fn) => fn(data));
      const request = async ({
        method,
        params = [],
      }: {
        method: string;
        params?: any[];
      }) => {
        calls.push(method);
        if (method === "eth_accounts" || method === "eth_requestAccounts")
          return selected ? [selected] : [];
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") {
          chain = params[0].chainId;
          emit("chainChanged", chain);
          return null;
        }
        if (method === "wallet_addEthereumChain") return null;
        if (method === "eth_getCode" && badRPC) return "0x";
        if (
          method === "eth_sendTransaction" ||
          method === "eth_signTypedData_v4"
        ) {
          if (reject) {
            reject = false;
            throw Object.assign(Error("User rejected"), { code: 4001 });
          }
          const from =
            method === "eth_sendTransaction" ? params[0].from : params[0];
          if (from?.toLowerCase() !== selected?.toLowerCase())
            throw Error("Provider refuses another account");
        }
        if (method === "eth_sendTransaction" && hold) {
          await new Promise((r) => setTimeout(r, 1500));
          hold = false;
        }
        const response = await fetch("http://127.0.0.1:8545", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method,
            params,
          }),
        });
        const body = await response.json();
        if (body.error)
          throw Object.assign(Error(body.error.message), {
            code: body.error.code,
          });
        if (method === "eth_sendTransaction") {
          lastHash = body.result;
          if (lost) {
            lost = false;
            throw Error("Simulated response lost after broadcast");
          }
        }
        return body.result;
      };
      (window as any).ethereum = {
        request,
        on: (name: string, fn: Function) => {
          (listeners[name] ||= []).push(fn);
        },
        removeListener: (name: string, fn: Function) => {
          listeners[name] = (listeners[name] || []).filter((x) => x !== fn);
        },
      };
      (window as any).walletTest = {
        account: (a: string) => {
          selected = a;
          emit("accountsChanged", a ? [a] : []);
        },
        chain: (id: string) => {
          chain = id;
          emit("chainChanged", chain);
        },
        reject: () => {
          reject = true;
        },
        badRPC: (value: boolean) => {
          badRPC = value;
        },
        loseResponse: () => {
          lost = true;
        },
        hold: () => {
          hold = true;
        },
        lastHash: () => lastHash,
        calls,
      };
    },
    { initial: account },
  );
}

test("browser-wallet setup deploys contracts, survives reload, mints test funds and creates one/five member quotes", async ({
  page,
}) => {
  test.setTimeout(90000);
  const rpc = async (method: string, params: any[] = []) => {
    const r = await fetch("http://127.0.0.1:8545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return (await r.json()).result;
  };
  const accounts = await rpc("eth_accounts");
  await installWallet(page, accounts[0]);
  await page.goto("/setup");
  await page.getByLabel("Deployment network").selectOption("31337");
  await page.getByRole("button", { name: "Connect deployment wallet" }).click();
  await page.getByRole("button", { name: "Estimate token deployment" }).click();
  await expect(
    page.getByRole("heading", { name: "Review DemoUSD" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).walletTest.loseResponse());
  await page
    .getByRole("button", { name: "Deploy DemoUSD with wallet" })
    .click();
  await expect(page.getByRole("status")).toContainText("RPC error");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("pactpay.setup.intent:31337")!).hash,
    ),
  ).toBeUndefined();
  await page.reload();
  await page.getByLabel("Deployment network").selectOption("31337");
  await expect(
    page.getByRole("button", { name: "Estimate token deployment" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Check saved deployment" }).click();
  await expect(page.getByRole("status")).toContainText("DemoUSD deployed and read back");
  await page.getByRole("button", { name: "Connect deployment wallet" }).click();
  await expect(
    page.getByRole("button", { name: "Estimate PactPay deployment" }),
  ).toBeEnabled({ timeout: 30000 });
  await page.reload();
  await page.getByLabel("Deployment network").selectOption("31337");
  await page.getByRole("button", { name: "Connect deployment wallet" }).click();
  await expect(
    page.getByRole("button", { name: "Estimate token deployment" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Estimate PactPay deployment" })
    .click();
  await page
    .getByRole("button", { name: "Deploy PactPay with wallet" })
    .click();
  await expect(page.getByLabel("Verified deployment JSON")).toBeVisible({
    timeout: 30000,
  });
  const config = JSON.parse(
    await page.getByLabel("Verified deployment JSON").inputValue(),
  );
  expect(config.accounts).toEqual([]);
  expect(config.chainId).toBe(31337);
  await page.getByLabel("Test token recipient").fill(accounts[1]);
  await page.getByLabel("Test token amount").fill("100");
  await page.evaluate(() => (window as any).walletTest.loseResponse());
  await page
    .getByRole("button", { name: "Mint test tokens with wallet" })
    .click();
  await expect(page.getByRole("status")).toContainText("RPC error");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("pactpay.setup.intent:31337")!).hash,
    ),
  ).toBeUndefined();
  await page.reload();
  await page.getByLabel("Deployment network").selectOption("31337");
  await page.getByRole("button", { name: "Check saved deployment" }).click();
  await expect(page.getByRole("status")).toContainText("Test tokens minted");
  await page.getByRole("link", { name: "Open workspace", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Start your first agreement" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  for (const count of [1, 5]) {
    await page
      .getByRole("button", { name: "New agreement", exact: true })
      .first()
      .click();
    await page.getByLabel("Number of contributors").selectOption(String(count));
    for (let i = 0; i < count; i++) {
      await page
        .getByLabel(`Member ${i + 1} wallet`, { exact: true })
        .fill(accounts[i + 1]);
      await page
        .getByLabel(`Member ${i + 1} · dUSD`, { exact: true })
        .fill("10");
    }
    await page.getByRole("button", { name: "Sign & create agreement" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 });
    await expect(
      page.getByText(`${count} contributor${count === 1 ? "" : "s"}`, {
        exact: true,
      }),
    ).toBeVisible();
    if (count === 1) {
      await page.evaluate(
        (a: string) => (window as any).walletTest.account(a),
        accounts[1],
      );
      await page.getByRole("button", { name: "Approve 10 dUSD" }).click();
      await expect(
        page.getByRole("button", { name: "Contribute 10 dUSD" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Contribute 10 dUSD" }).click();
      await expect(page.getByText("10 of 10 dUSD contributed")).toBeVisible();
      await page.evaluate(
        (a: string) => (window as any).walletTest.account(a),
        accounts[0],
      );
    }
  }
  await page.screenshot({
    path: "evidence/setup-workspace.png",
    fullPage: true,
  });
  fs.writeFileSync(
    "evidence/browser-setup.json",
    JSON.stringify(
      {
        mode: "simulated wallet backed by actual local EVM",
        chainId: 31337,
        config,
        flows: [
          "deploy token",
          "recover actual deployment broadcast with lost hash after reload",
          "reload progress",
          "deploy escrow",
          "verify binding decimals code",
          "mint test funds",
          "recover actual mint broadcast with lost hash after reload",
          "fresh workspace without bundled quote",
          "one member quote",
          "minted member approval and contribution",
          "five member quote",
        ],
        v3: false,
        realExtension: false,
      },
      null,
      2,
    ),
  );
});
