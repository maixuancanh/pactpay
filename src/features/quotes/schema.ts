import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  hashTypedData,
  recoverTypedDataAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
export type Terms = {
  title: string;
  description: string;
  merchantName: string;
  currency: string;
};
export const quoteTypes = {
  Quote: [
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
    { name: "membersHash", type: "bytes32" },
    { name: "sharesHash", type: "bytes32" },
    { name: "total", type: "uint256" },
    { name: "fundingDeadline", type: "uint64" },
    { name: "captureDeadline", type: "uint64" },
  ],
} as const;
export type Quote = {
  merchant: Address;
  token: Address;
  nonce: bigint;
  termsHash: Hex;
  membersHash: Hex;
  sharesHash: Hex;
  total: bigint;
  fundingDeadline: bigint;
  captureDeadline: bigint;
};
export type QuotePackage = {
  schemaVersion: 1;
  chainId: number;
  contract: Address;
  terms: Terms;
  quote: Quote;
  members: Address[];
  shares: bigint[];
  signature: Hex;
  id: Hex;
};
export function hashTerms(t: Terms) {
  return keccak256(
    stringToHex(
      JSON.stringify({
        currency: t.currency,
        description: t.description,
        merchantName: t.merchantName,
        title: t.title,
      }),
    ),
  );
}
export const hashMembers = (a: Address[]) =>
  keccak256(encodeAbiParameters([{ type: "address[]" }], [a]));
export const hashShares = (a: bigint[]) =>
  keccak256(encodeAbiParameters([{ type: "uint256[]" }], [a]));
export function makeQuote(
  merchant: Address,
  token: Address,
  terms: Terms,
  members: Address[],
  shares: bigint[],
  fundingDeadline: bigint,
  captureDeadline: bigint,
  nonce: bigint,
): Quote {
  return {
    merchant,
    token,
    nonce,
    termsHash: hashTerms(terms),
    membersHash: hashMembers(members),
    sharesHash: hashShares(shares),
    total: shares.reduce((a, b) => a + b, 0n),
    fundingDeadline,
    captureDeadline,
  };
}
export function quoteTypedData(chainId: number, contract: Address, q: Quote) {
  return {
    domain: {
      name: "PactPay",
      version: "1",
      chainId,
      verifyingContract: contract,
    },
    types: quoteTypes,
    primaryType: "Quote" as const,
    message: q,
  };
}
export function serializePackage(p: QuotePackage) {
  return JSON.stringify(
    p,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}
export async function parsePackage(raw: string): Promise<QuotePackage> {
  if (raw.length > 50000) throw Error("Quote package is too large.");
  const p = JSON.parse(raw);
  if (
    p.schemaVersion !== 1 ||
    !Number.isSafeInteger(p.chainId) ||
    !isAddress(p.contract)
  )
    throw Error("Unsupported package or network.");
  const t = p.terms;
  if (
    !t ||
    typeof t.title !== "string" ||
    t.title.length < 1 ||
    t.title.length > 120 ||
    typeof t.description !== "string" ||
    t.description.length > 4000 ||
    typeof t.merchantName !== "string" ||
    t.merchantName.length > 100 ||
    t.currency !== "dUSD"
  )
    throw Error("Terms are missing or invalid.");
  const q = { ...p.quote };
  for (const f of ["nonce", "total", "fundingDeadline", "captureDeadline"]) {
    if (typeof q[f] !== "string" || !/^\d+$/.test(q[f]))
      throw Error("Invalid integer.");
    q[f] = BigInt(q[f]);
  }
  if (!isAddress(q.merchant) || !isAddress(q.token))
    throw Error("Invalid parties.");
  if (
    !Array.isArray(p.members) ||
    p.members.length < 1 ||
    p.members.length > 5 ||
    p.members.some((x: unknown) => typeof x !== "string" || !isAddress(x)) ||
    new Set(p.members.map((x: string) => x.toLowerCase())).size !==
      p.members.length
  )
    throw Error("Invalid members.");
  if (
    !Array.isArray(p.shares) ||
    p.shares.length !== p.members.length ||
    p.shares.some((x: unknown) => typeof x !== "string" || !/^\d+$/.test(x))
  )
    throw Error("Invalid shares.");
  const shares = p.shares.map(BigInt);
  if (hashTerms(t) !== q.termsHash) throw Error("Terms have been modified.");
  if (hashMembers(p.members) !== q.membersHash)
    throw Error("Members have been modified.");
  if (
    hashShares(shares) !== q.sharesHash ||
    shares.some((x: bigint) => x <= 0n) ||
    shares.reduce((a: bigint, b: bigint) => a + b, 0n) !== q.total
  )
    throw Error("Shares have been modified.");
  const typed = quoteTypedData(p.chainId, p.contract, q);
  if (hashTypedData(typed) !== p.id) throw Error("Quote ID/domain mismatch.");
  const signer = await recoverTypedDataAddress({
    ...typed,
    signature: p.signature,
  });
  if (signer.toLowerCase() !== q.merchant.toLowerCase())
    throw Error("Merchant signature does not match.");
  if (q.fundingDeadline >= q.captureDeadline) throw Error("Invalid deadlines.");
  return { ...p, quote: q, shares };
}
