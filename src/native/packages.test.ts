import { describe, it, expect } from "vitest";
import { makeQuote, quoteTypedData } from "../features/quotes/schema";
import { hashTypedData, type Address } from "viem";
import { parseNativePackage, serializeNativePackage } from "./packages";
const merchant = ("0x" + "11".repeat(20)) as Address,
  token = ("0x" + "22".repeat(20)) as Address,
  contract = ("0x" + "33".repeat(20)) as Address;
const terms = {
  title: "Team lunch",
  description: "Fixed group shares",
  merchantName: "A merchant",
  currency: "dUSD",
};
const quote = makeQuote(
  merchant,
  token,
  terms,
  [merchant],
  [1000000n],
  1000n,
  2000n,
  1n,
);
const pack = {
  schema: "pactpay-native-v1" as const,
  chainId: 420420777 as const,
  contract,
  terms,
  quote,
  members: [merchant],
  shares: [1000000n],
  id: hashTypedData(quoteTypedData(420420777, contract, quote)),
};
describe("native transaction-authorized packages", () => {
  it("roundtrips exact units without pretending a native signature is EIP712", () => {
    const p = parseNativePackage(serializeNativePackage(pack), {
      contract,
      token,
    });
    expect(p.quote.total).toBe(1000000n);
    expect("signature" in p).toBe(false);
  });
  it("rejects altered terms/shares/network/deployment before chain interaction", () => {
    const raw = JSON.parse(serializeNativePackage(pack));
    for (const bad of [
      { ...raw, terms: { ...raw.terms, title: "Different" } },
      { ...raw, shares: ["2"] },
      { ...raw, chainId: 1 },
      { ...raw, contract: token },
      { ...raw, id: "0x" + "00".repeat(32) },
    ])
      expect(() =>
        parseNativePackage(JSON.stringify(bad), { contract, token }),
      ).toThrow();
  });
  it('rejects hidden signer material or unexpected fields before portable export',()=>{
    const raw=JSON.parse(serializeNativePackage(pack));
    for(const bad of [{...raw,signature:'0x1234'},{...raw,quote:{...raw.quote,privateKey:'secret'}},{...raw,terms:{...raw.terms,seed:'secret'}}])expect(()=>parseNativePackage(JSON.stringify(bad),{contract,token})).toThrow();
  });
});

it('rejects a hash-consistent package containing a zero-address member',()=>{
 const members=['0x0000000000000000000000000000000000000000'] as Address[];
 const invalidQuote=makeQuote(merchant,token,terms,members,pack.shares,1000n,2000n,1n);
 const invalid={...pack,members,quote:invalidQuote,id:hashTypedData(quoteTypedData(420420777,contract,invalidQuote))};
 expect(()=>parseNativePackage(serializeNativePackage(invalid),{contract,token})).toThrow(/members/i);
});
