import { describe, it, expect } from "vitest";
import {
  hashTypedData,
  keccak256,
  stringToHex,
  type Address,
  type PublicClient,
} from "viem";
import {
  makeQuote,
  hashTerms,
  quoteTypedData,
} from "../features/quotes/schema";
import { canonicalTerms, recoverTermsPackage } from "./terms";
const merchant = ("0x" + "11".repeat(20)) as Address,
  token = ("0x" + "22".repeat(20)) as Address,
  contract = ("0x" + "33".repeat(20)) as Address;
const terms = {
  title: "Workshop",
  description: "Tiếng Việt",
  merchantName: "Studio",
  currency: "dUSD",
};
const q = makeQuote(
  merchant,
  token,
  terms,
  [merchant],
  [100n],
  1000n,
  2000n,
  1n,
);
const id = hashTypedData(quoteTypedData(420420777, contract, q));
function fixture(
  text = JSON.stringify({
    currency: terms.currency,
    description: terms.description,
    merchantName: terms.merchantName,
    title: terms.title,
  }),
  onQuote = q,
  members = [merchant],
) {
  const calls: any[] = [];
  const log = {
    address: contract,
    args: { quoteId: id, terms: text },
    blockNumber: 12n,
    blockHash: "0xabc",
    transactionHash: "0xdef",
    logIndex: 0,
    data: "0x1234",
    topics: ["0x1234"],
  };
  const client = {
    getTransactionReceipt: async () => ({
      status: "success",
      blockHash: log.blockHash,
      blockNumber: 12n,
      logs: [log],
    }),
    readContract: async (x: any) => {
      calls.push(x);
      return x.functionName === "getQuote" ? [onQuote, 1, 0n, members] : 100n;
    },
    getContractEvents: async (x: any) => {
      calls.push(x);
      return [log];
    },
  };
  return {
    client: client as unknown as Pick<
      PublicClient,
      "readContract" | "getContractEvents" | "getTransactionReceipt"
    >,
    calls,
  };
}
describe("recoverable original agreement terms", () => {
  it("serializes the existing hash schema exactly", () =>
    expect(keccak256(stringToHex(canonicalTerms(terms)))).toBe(
      hashTerms(terms),
    ));
  it("recovers a validated package from a bounded creation block", async () => {
    const { client, calls } = fixture();
    const p = await recoverTermsPackage(client, { contract, token }, id, {
      fromBlock: 12n,
      toBlock: 12n,
    });
    expect(p.terms).toEqual(terms);
    expect(p.shares).toEqual([100n]);
    expect(
      calls.every((x) => x.blockNumber === 12n || x.fromBlock === 12n),
    ).toBe(true);
  });
  it("rejects tampered or noncanonical event text and missing original terms", async () => {
    for (const text of [
      canonicalTerms({ ...terms, title: "Changed" }),
      JSON.stringify(terms),
      "",
    ]) {
      const { client } = fixture(text);
      await expect(
        recoverTermsPackage(client, { contract, token }, id, {
          fromBlock: 12n,
          toBlock: 12n,
        }),
      ).rejects.toThrow();
    }
    const { client } = fixture();
    client.getContractEvents = async () => [];
    await expect(
      recoverTermsPackage(client, { contract, token }, id, {
        fromBlock: 12n,
        toBlock: 12n,
      }),
    ).rejects.toThrow(/not published|not found/i);
  });
  it("rejects zero/duplicate members and an oversized recovery interval", async () => {
    for (const members of [
      ["0x0000000000000000000000000000000000000000"],
      [merchant, merchant],
    ]) {
      const { client } = fixture(
        canonicalTerms(terms),
        q,
        members as Address[],
      );
      await expect(
        recoverTermsPackage(client, { contract, token }, id, {
          fromBlock: 12n,
          toBlock: 12n,
        }),
      ).rejects.toThrow();
    }
    const { client } = fixture();
    await expect(
      recoverTermsPackage(client, { contract, token }, id, {
        fromBlock: 0n,
        toBlock: 5000n,
      }),
    ).rejects.toThrow(/range|2000/);
  });
});

it("rejects published terms absent from a successful receipt", async () => {
  const { client } = fixture();
  (client as any).getTransactionReceipt = async () => ({
    status: "reverted",
    logs: [],
  });
  await expect(
    recoverTermsPackage(client, { contract, token }, id, {
      fromBlock: 12n,
      toBlock: 12n,
    }),
  ).rejects.toThrow(/receipt/i);
});
