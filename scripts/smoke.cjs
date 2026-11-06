const hre = require("hardhat");
const fs = require("fs");
const { ethers } = hre;
async function main() {
  const d = JSON.parse(fs.readFileSync("public/deployment.json"));
  if (d.mode !== "local") throw Error("This smoke only permits local chain.");
  const [m, a, b, c] = await ethers.getSigners();
  const p = await ethers.getContractAt("PactPay", d.contract);
  const token = await ethers.getContractAt("DemoUSD", d.token);
  const types = {
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
  };
  let receipts = [];
  const record = async (label, tx) => {
    const r = await (await tx).wait();
    if (r.status !== 1) throw Error(label + " failed");
    receipts.push({
      label,
      hash: r.hash,
      blockNumber: r.blockNumber,
      status: r.status,
    });
  };
  let outcomes = [];
  for (const scenario of [
    "success",
    "partial-expiry",
    "capture-expiry",
    "cancel",
  ]) {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const members = [a.address, b.address, c.address],
      shares = [40000000n, 35000000n, 25000000n];
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const q = {
      merchant: m.address,
      token: d.token,
      nonce: BigInt(Date.now()) + BigInt(outcomes.length),
      termsHash: ethers.id(scenario),
      membersHash: ethers.keccak256(coder.encode(["address[]"], [members])),
      sharesHash: ethers.keccak256(coder.encode(["uint256[]"], [shares])),
      total: 100000000n,
      fundingDeadline: now + 100,
      captureDeadline: now + 200,
    };
    const domain = {
      name: "PactPay",
      version: "1",
      chainId: 31337,
      verifyingContract: d.contract,
    };
    const id = ethers.TypedDataEncoder.hash(domain, types, q);
    const sig = await m.signTypedData(domain, types, q);
    await record(scenario + ":create", p.createQuote(q, members, shares, sig));
    const before = {};
    for (const s of [m, a, b, c])
      before[s.address] = String(await token.balanceOf(s.address));
    for (const s of scenario === "partial-expiry" ? [a] : [a, b, c]) {
      await record(
        scenario + ":approve",
        token.connect(s).approve(d.contract, 100000000n),
      );
      await record(
        scenario + ":contribute",
        p.connect(s).contribute(id, q.termsHash),
      );
    }
    if (scenario === "success") {
      await record("capture", p.capture(id));
      await record("merchant claim", p.claim(id));
    } else {
      if (scenario === "cancel") await record("cancel", p.cancel(id));
      else {
        await hre.network.provider.send("evm_setNextBlockTimestamp", [
          scenario === "partial-expiry" ? q.fundingDeadline : q.captureDeadline,
        ]);
        await record("expire", p.expire(id));
      }
      for (const s of [a, b, c])
        if ((await p.credits(id, s.address)) > 0n)
          await record("refund claim", p.connect(s).claim(id));
    }
    const after = {};
    for (const s of [m, a, b, c])
      after[s.address] = String(await token.balanceOf(s.address));
    if (
      scenario !== "success" &&
      JSON.stringify(before) !== JSON.stringify(after)
    )
      throw Error("Refund balance mismatch");
    const state = (await p.getQuote(id)).state;
    outcomes.push({
      scenario,
      quoteId: id,
      state: Number(state),
      before,
      after,
    });
  }
  const liability = await p.totalLiability();
  const balance = await token.balanceOf(d.contract);
  if (balance < liability) throw Error("Insolvent");
  const out = {
    mode: "local",
    checkedAt: new Date().toISOString(),
    chainId: 31337,
    contract: d.contract,
    token: d.token,
    codeHash: ethers.keccak256(await ethers.provider.getCode(d.contract)),
    compiler: "0.8.24",
    evmVersion: "paris",
    outcomes,
    receipts,
    liability: String(liability),
    balance: String(balance),
    v3Verified: false,
  };
  fs.writeFileSync("evidence/manifest.json", JSON.stringify(out, null, 2));
  console.log(
    "PASS: four local workflows, " +
      receipts.length +
      " successful receipts; token balance >= liabilities.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
