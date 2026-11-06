import { test, expect } from "@playwright/test";
import fs from "node:fs";
test.beforeAll(async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync("cmd.exe", ["/c", "npm run deploy:local"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});
const deployment = () =>
  JSON.parse(fs.readFileSync("public/deployment.json", "utf8"));
async function installWallet(page: any, account: string) {
  await page.addInitScript(
    ({ initial }: { initial: string }) => {
      const listeners: Record<string, Function[]> = {};
      let selected = initial,
        chain = "0x7a69",
        reject = false,
        badRPC = false,
        hold = false, lost = false;
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
        if (method === "eth_sendTransaction") { lastHash = body.result; if (lost) { lost = false; throw Error("Simulated response lost after broadcast"); } }
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
        loseResponse: () => { lost = true; },
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
test("injected-wallet DApp journey: authority, wrong network/deployment, rejection, real payment and reload", async ({
  page,
}) => {
  const d = deployment(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installWallet(page, d.accounts[3]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "One purchase. Everyone keeps control.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  // Account authorization is taken only from the injected provider.
  await page.evaluate(() =>
    (window as any).walletTest.account(
      "0x1000000000000000000000000000000000000001",
    ),
  );
  await expect(page.getByText("Read-only for this wallet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve 25 dUSD" }),
  ).toHaveCount(0);
  await page.evaluate(
    (a: string) => (window as any).walletTest.account(a),
    d.accounts[3],
  );
  await expect(
    page.getByRole("button", { name: "Approve 25 dUSD" }),
  ).toBeEnabled();
  await page.evaluate(() => (window as any).walletTest.chain("0x1"));
  await expect(
    page.getByRole("button", { name: "Approve 25 dUSD" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Switch network", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve 25 dUSD" }),
  ).toBeEnabled();
  await page.evaluate(() => (window as any).walletTest.badRPC(true));
  await page.getByRole("button", { name: "Approve 25 dUSD" }).click();
  await expect(page.getByRole("alert")).toContainText("different deployment");
  await page.evaluate(() => (window as any).walletTest.badRPC(false));
  await page.evaluate(() => (window as any).walletTest.reject());
  await page.getByRole("button", { name: "Approve 25 dUSD" }).click();
  await expect(page.getByRole("alert")).toContainText("declined");
  await page.getByRole("button", { name: "Approve 25 dUSD" }).click();
  await expect(
    page.getByRole("button", { name: "Contribute 25 dUSD" }),
  ).toBeEnabled();
  await page.evaluate(() => (window as any).walletTest.loseResponse());
  await page.getByRole("button", { name: "Contribute 25 dUSD" }).click();
  await expect(page.getByRole("button", {name: "Check receipt", exact: true})).toBeVisible();
  const savedIntent = await page.evaluate(() => JSON.parse(localStorage.getItem("pactpay.pending.v1") || "null"));
  expect(savedIntent.hash).toBeUndefined();
  expect(savedIntent.data).toMatch(/^0x/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("100 of 100 dUSD contributed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check receipt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check receipt", exact: true })
    .click();
  await expect(
    page.getByText("Transaction confirmed. State refreshed.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (a: string) => (window as any).walletTest.account(a),
    d.accounts[0],
  );
  await expect(
    page.getByRole("button", { name: "Accept & capture order" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Accept & capture order" }).click();
  await expect(
    page.getByRole("button", { name: "Claim 100 dUSD" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Claim 100 dUSD" }).click();
  await expect(
    page.getByText("Paid to merchant", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The merchant’s payout was claimed.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Merchant inbox", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: /Orders for/ })).toBeVisible();
  await expect(page.getByText("Payout claimed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.evaluate(
    (a: string) => (window as any).walletTest.account(a),
    d.accounts[0],
  );
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Active local role" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "evidence/dapp-wallet-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "evidence/dapp-wallet-mobile.png",
    fullPage: true,
  });
  fs.writeFileSync(
    "evidence/dapp-wallet-browser.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        mode: "simulated EIP-1193 provider backed by real local RPC",
        flows: [
          "connect",
          "account changes",
          "read-only unknown account",
          "wrong network switch",
          "same-chain wrong deployment blocked",
          "signature rejection",
          "token approval",
          "contribution",
          "persisted pending receipt reconciliation after reload",
          "capture",
          "claim",
          "merchant inbox",
          "disconnect stays disconnected",
        ],
        pageErrors: errors,
        mobile390Overflow: false,
        realExtension: false,
        v3: false,
      },
      null,
      2,
    ),
  );
});

test("dialogs trap keyboard focus and restore trigger; no-provider has a clear recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText("No wallet found");
  const trigger = page.getByRole("button", {
    name: "Import agreement",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el: any) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
