import { describe, it, expect } from "vitest";
import { parsePackage, hashTerms, makeQuote, quoteTypedData } from "./schema";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, type Address } from "viem";
const merchant = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const contract = "0x1000000000000000000000000000000000000000";
const token = "0x2000000000000000000000000000000000000000";
describe("portable quote package", () => {
  it("verifies merchant signature and terms after a fresh JSON import", async () => {
    const terms = {
      title: "Design workshop",
      description: "One session",
      merchantName: "Common Ground",
      currency: "dUSD",
    };
    const members: Address[] = ["0x3000000000000000000000000000000000000000"];
    const q = makeQuote(
      merchant.address,
      token,
      terms,
      members,
      [1000000n],
      1000n,
      2000n,
      1n,
    );
    const typed = quoteTypedData(31337, contract, q);
    const sig = await merchant.signTypedData(typed);
    const pkg = {
      schemaVersion: 1,
      chainId: 31337,
      contract,
      terms,
      quote: q,
      members,
      shares: ["1000000"],
      signature: sig,
      id: hashTypedData(typed),
    };
    const raw = JSON.stringify(pkg, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    const parsed = await parsePackage(raw);
    expect(parsed.id).eq(pkg.id);
    expect(hashTerms(parsed.terms)).eq(q.termsHash);
  });
  it("rejects modified terms, shares and signature", async () => {
    const terms = {
      title: "Original",
      description: "One session",
      merchantName: "Merchant",
      currency: "dUSD",
    };
    const members: Address[] = ["0x3000000000000000000000000000000000000000"];
    const q = makeQuote(
      merchant.address,
      token,
      terms,
      members,
      [1000000n],
      1000n,
      2000n,
      1n,
    );
    const t = quoteTypedData(31337, contract, q);
    const p = {
      schemaVersion: 1,
      chainId: 31337,
      contract,
      terms,
      quote: q,
      members,
      shares: ["1000000"],
      signature: await merchant.signTypedData(t),
      id: hashTypedData(t),
    };
    const raw = (x: unknown) =>
      JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    await expect(
      parsePackage(raw({ ...p, terms: { ...terms, title: "Fake" } })),
    ).rejects.toThrow("Terms");
    await expect(parsePackage(raw({ ...p, shares: ["2"] }))).rejects.toThrow(
      "Shares",
    );
    await expect(parsePackage(raw({ ...p, chainId: 1 }))).rejects.toThrow();
  });
});
