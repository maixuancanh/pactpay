import { test, expect } from "@playwright/test";
test.beforeAll(async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync("cmd.exe", ["/c", "npm run deploy:local"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});
test("real local checkout, merchant capture and payout; portable package on mobile", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try local demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good things happen together." }),
  ).toBeVisible();
  await expect(page.getByText("75 of 100 dUSD contributed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve 25 dUSD" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Approve 25 dUSD" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Token approval confirmed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Contribute 25 dUSD" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Contribute 25 dUSD" }).click();
  await expect(page.getByText("100 of 100 dUSD contributed")).toBeVisible();
  await expect(page.getByText("Waiting for merchant acceptance")).toBeVisible();
  await page.getByLabel("Active local role").selectOption({ index: 0 });
  await page.getByRole("button", { name: "Accept & capture order" }).click();
  await expect(
    page.getByRole("button", { name: "Claim 100 dUSD" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Payment captured", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Claim 100 dUSD" }).click();
  await expect(
    page.getByText("Paid to merchant", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Merchant payout confirmed" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "evidence/desktop-paid.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  await file.saveAs("evidence/exported-quote.json");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const p = await mobile.newPage();
  await p.goto("/");
  await p.getByRole("button", { name: "Try local demo", exact: true }).click();
  await p
    .getByRole("button", { name: "Import agreement", exact: true })
    .click();
  await p
    .locator("input[type=file]")
    .setInputFiles("evidence/exported-quote.json");
  await p.getByRole("button", { name: "Verify & open agreement" }).click();
  await expect(p.getByText("Paid to merchant", { exact: true })).toBeVisible();
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.screenshot({ path: "evidence/mobile-paid.png", fullPage: true });
  await mobile.close();
});
test("stale forced transaction revert is reported as failure, never confirmed", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try local demo", exact: true })
    .click();
  await expect(
    page.getByText("Paid to merchant", { exact: true }),
  ).toBeVisible();
  // Intercept only the next wallet send: a duplicate capture on the actual paid contract reverts.
  await page.route("http://127.0.0.1:8545", async (route) => {
    const body = route.request().postDataJSON();
    await route.continue();
  });
  await page.getByLabel("Active local role").selectOption({ index: 0 });
  await page
    .getByRole("button", { name: "New agreement", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByLabel("Agreement title")
    .fill("Fresh agreement after paid quote");
  await page.getByRole("button", { name: "Sign & create agreement" }).click();
  await expect(
    page.getByRole("heading", { name: "Fresh agreement after paid quote" }),
  ).toBeVisible();
  await expect(page.getByText("0 of 100 dUSD contributed")).toBeVisible();
  await page.getByLabel("Active local role").selectOption({ index: 1 });
  await expect(
    page.getByRole("button", { name: "Contribute 40 dUSD" }),
  ).toBeEnabled();
  // Race: UI sees Funding, then merchant cancellation is sent directly before member contribution.
  const dep = await (await page.request.get("/deployment.json")).json();
  const raw = await page.evaluate(() =>
    localStorage.getItem("pactpay.last-open-package"),
  );
  const pkg = JSON.parse(raw!);
  const { createWalletClient, http, parseAbi } = await import("viem");
  const { foundry } = await import("viem/chains");
  const w = createWalletClient({
    account: dep.accounts[0],
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  });
  await w.writeContract({
    address: dep.contract,
    abi: parseAbi(["function cancel(bytes32)"]),
    functionName: "cancel",
    args: [pkg.id],
    gas: 500000n,
  });
  await page.getByRole("button", { name: "Contribute 40 dUSD" }).click();
  await expect(page.getByRole("alert")).toContainText(/reverted/i);
  await expect(
    page.getByText("Contribution confirmed on the local chain."),
  ).toHaveCount(0);
});
