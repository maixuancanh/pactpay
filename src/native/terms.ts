import {
  keccak256,
  stringToHex,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { Terms } from "../features/quotes/schema";
import {
  parseNativePackage,
  serializeNativePackage,
  type NativeQuotePackage,
} from "./packages";
import abi from "../lib/pact-abi.json";
export const MAX_TERMS_BYTES = 16000;
/** Only call with text from a verified finalized native ContractEmitted event. */
export async function packageFromNativeTerms(client:Pick<PublicClient,'readContract'>,config:{contract:Address;token:Address},id:Hex,text:string,blockNumber:bigint){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_TERMS_BYTES)throw Error('Invalid native terms size');
 const terms=JSON.parse(text);if(canonicalTerms(terms)!==text)throw Error('Noncanonical native terms');
 const [quote,state,,members]=await client.readContract({address:config.contract,abi,functionName:'getQuote',args:[id],blockNumber}) as any;
 if(Number(state)===0||keccak256(stringToHex(text))!==quote.termsHash)throw Error('Native terms do not match quote');
 const shares=await Promise.all(members.map((m:Address)=>client.readContract({address:config.contract,abi,functionName:'shares',args:[id,m],blockNumber})));
 return parseNativePackage(serializeNativePackage({schema:'pactpay-native-v1',chainId:420420777,contract:config.contract,terms,quote,members,shares:shares as bigint[],id}),config);
}
/** Exact key order used by the existing termsHash schema. */
export function canonicalTerms(t: Terms): string {
  const text = JSON.stringify({
    currency: t.currency,
    description: t.description,
    merchantName: t.merchantName,
    title: t.title,
  });
  if (new TextEncoder().encode(text).length > MAX_TERMS_BYTES)
    throw Error("Public agreement terms exceed 16000 bytes.");
  return text;
}
const events = parseAbi([
  "event TermsPublished(bytes32 indexed quoteId,string terms)",
]);
/** Caller verifies deployment identity and supplies a range at or below finalized head. */
export async function recoverTermsPackage(
  client: Pick<
    PublicClient,
    "readContract" | "getContractEvents" | "getTransactionReceipt"
  >,
  config: { contract: Address; token: Address },
  id: Hex,
  options: { fromBlock: bigint; toBlock: bigint },
): Promise<NativeQuotePackage> {
  const { fromBlock, toBlock } = options;
  if (fromBlock < 0n || toBlock < fromBlock || toBlock - fromBlock >= 2000n)
    throw Error("Recovery range must contain 1–2000 finalized blocks.");
  const logs: any[] = [];
  for (let from = fromBlock; from <= toBlock; from += 250n) {
    const to = from + 249n < toBlock ? from + 249n : toBlock;
    logs.push(
      ...(await client.getContractEvents({
        address: config.contract,
        abi: events,
        eventName: "TermsPublished",
        args: { quoteId: id },
        fromBlock: from,
        toBlock: to,
        strict: true,
      })),
    );
  }
  const published = logs.filter(
    (log) =>
      !log.removed &&
      String(log.address).toLowerCase() === config.contract.toLowerCase() &&
      String(log.args.quoteId).toLowerCase() === id.toLowerCase() &&
      log.blockNumber >= fromBlock &&
      log.blockNumber <= toBlock,
  );
  if (published.length !== 1)
    throw Error(
      published.length
        ? "Ambiguous published terms."
        : "Original terms were not published or were not found in this range. Legacy agreements require the merchant agreement file.",
    );
  const log = published[0];
  const receipt = await client.getTransactionReceipt({
    hash: log.transactionHash,
  });
  if (
    receipt.status !== "success" ||
    receipt.blockHash !== log.blockHash ||
    receipt.blockNumber !== log.blockNumber ||
    !receipt.logs.some(
      (item) =>
        item.logIndex === log.logIndex &&
        item.address.toLowerCase() === config.contract.toLowerCase() &&
        item.blockHash === log.blockHash &&
        item.data === log.data &&
        JSON.stringify(item.topics) === JSON.stringify(log.topics),
    )
  )
    throw Error("Published terms receipt mismatch.");
  const text = log.args.terms;
  if (
    typeof text !== "string" ||
    !text ||
    new TextEncoder().encode(text).length > MAX_TERMS_BYTES
  )
    throw Error("Invalid published terms size.");
  const terms = JSON.parse(text);
  if (canonicalTerms(terms) !== text)
    throw Error("Published terms are not canonical.");
  const result = (await client.readContract({
    address: config.contract,
    abi,
    functionName: "getQuote",
    args: [id],
    blockNumber: toBlock,
  })) as readonly [NativeQuotePackage["quote"], number, bigint, Address[]];
  const [quote, state, , members] = result;
  if (Number(state) === 0 || keccak256(stringToHex(text)) !== quote.termsHash)
    throw Error("Published terms do not match the created agreement.");
  const shares = await Promise.all(
    members.map(
      (member) =>
        client.readContract({
          address: config.contract,
          abi,
          functionName: "shares",
          args: [id, member],
          blockNumber: toBlock,
        }) as Promise<bigint>,
    ),
  );
  return parseNativePackage(
    serializeNativePackage({
      schema: "pactpay-native-v1",
      chainId: 420420777,
      contract: config.contract,
      terms,
      quote,
      members,
      shares,
      id,
    }),
    config,
  );
}
