const fs = require("fs");
const { JsonRpcProvider, keccak256, Contract } = require("ethers");
(async () => {
  const m = JSON.parse(fs.readFileSync("evidence/manifest.json"));
  if (m.mode !== "local" || m.chainId !== 31337)
    throw Error("Only local evidence supported by this verifier");
  const p = new JsonRpcProvider("http://127.0.0.1:8545");
  if (Number((await p.getNetwork()).chainId) !== m.chainId)
    throw Error("chain mismatch");
  if (keccak256(await p.getCode(m.contract)) !== m.codeHash)
    throw Error("code hash mismatch");
  for (const r of m.receipts) {
    const actual = await p.getTransactionReceipt(r.hash);
    if (!actual || actual.status !== 1 || actual.blockNumber !== r.blockNumber)
      throw Error("receipt missing/mismatch");
  }
  const c = new Contract(
    m.contract,
    [
      "function totalLiability() view returns(uint256)",
      "function getQuote(bytes32) view returns((address merchant,address token,uint256 nonce,bytes32 termsHash,bytes32 membersHash,bytes32 sharesHash,uint256 total,uint64 fundingDeadline,uint64 captureDeadline),uint8 state,uint256 held,address[] members)",
    ],
    p,
  );
  for (const o of m.outcomes) {
    const q = await c.getQuote(o.quoteId);
    if (Number(q.state) !== o.state) throw Error("state mismatch");
  }
  console.log(
    "PASS: code hash, " +
      m.receipts.length +
      " receipts and " +
      m.outcomes.length +
      " terminal workflow states verified against current local node. Not V3.",
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
