import { it, expect } from "vitest";
import { requireSuccessfulReceipt, findIntentHash, explicitlyRejected } from "./transactions";
it("rejects mined reverted receipt rather than reporting confirmation", () => {
  expect(() =>
    requireSuccessfulReceipt({ status: "reverted" }, "Payment"),
  ).toThrow("reverted");
  expect(() =>
    requireSuccessfulReceipt({ status: "success" }, "Payment"),
  ).not.toThrow();
});

it("recovers only exact saved payload and destination, never matching another approval", async () => {
  const p = { label: "Approve", chainId: 1, contract: "0x11", quoteId: "q", from: "0xaa", nonce: 3, to: "0xbb", data: "0x12", value: "0", startBlock: "5" } as any;
  const client = { getBlockNumber: async()=>6n, getBlock: async({blockNumber}:any)=>({transactions: blockNumber===5n ? [{from:"0xaa",nonce:3,to:"0xcc",input:"0x12",value:0n,hash:"wrong"}] : [{from:"0xaa",nonce:3,to:"0xbb",input:"0x12",value:0n,hash:"right"}]}) };
  expect(await findIntentHash(client,p)).toBe("right");
  expect(await findIntentHash(client,{...p,data:"0x99"})).toBeNull();
  expect(explicitlyRejected({cause:{code:4001}})).toBe(true);
  expect(explicitlyRejected(Error("network timeout"))).toBe(false);
});
