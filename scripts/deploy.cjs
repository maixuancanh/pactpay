const hre = require("hardhat");
const fs = require("fs");
const { ethers } = hre;
const TYPES = {
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
async function main() {
  const chain = await ethers.provider.getNetwork();
  const local = chain.chainId === 31337n;
  if (!local && !process.env.PACTPAY_DEPLOY_KEY)
    throw Error("PACTPAY_DEPLOY_KEY required; no key is read automatically.");
  const signers = await ethers.getSigners();
  const merchant = signers[0];
  const token = await (await ethers.getContractFactory("DemoUSD")).deploy();
  await token.waitForDeployment();
  const pact = await (
    await ethers.getContractFactory("PactPay")
  ).deploy(token.target);
  await pact.waitForDeployment();
  const receipt = await pact.deploymentTransaction().wait();
  const deployment = {
    mode: local ? "local" : "testnet",
    chainId: Number(chain.chainId),
    contract: pact.target,
    token: token.target,
    accounts: local
      ? signers.slice(0, 4).map((x) => x.address)
      : [merchant.address],
    blockNumber: String(receipt.blockNumber),
    codeHash: ethers.keccak256(await ethers.provider.getCode(pact.target)),
    compiler: "0.8.24",
    evmVersion: "paris",
  };
  fs.writeFileSync(
    "public/deployment.json",
    JSON.stringify(deployment, null, 2),
  );
  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync(
    "evidence/deployment.json",
    JSON.stringify({ ...deployment, txHash: receipt.hash }, null, 2),
  );
  fs.writeFileSync(
    "src/lib/pact-abi.json",
    JSON.stringify((await hre.artifacts.readArtifact("PactPay")).abi),
  );
  if (local) {
    const members = signers.slice(1, 4).map((x) => x.address);
    for (const x of members)
      await (await token.mint(x, 1000n * 1000000n)).wait();
    const terms = {
      title: "A brand workshop, together",
      description:
        "A 90-minute remote brand workshop for three independent makers. One shared session, one merchant, one agreed price. Delivery is arranged directly with the merchant after payment.",
      merchantName: "Common Ground Studio",
      currency: "dUSD",
    };
    const canonical = JSON.stringify({
      currency: terms.currency,
      description: terms.description,
      merchantName: terms.merchantName,
      title: terms.title,
    });
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const shares = [40n * 1000000n, 35n * 1000000n, 25n * 1000000n];
    const quote = {
      merchant: merchant.address,
      token: token.target,
      nonce: 1n,
      termsHash: ethers.keccak256(ethers.toUtf8Bytes(canonical)),
      membersHash: ethers.keccak256(coder.encode(["address[]"], [members])),
      sharesHash: ethers.keccak256(coder.encode(["uint256[]"], [shares])),
      total: 100n * 1000000n,
      fundingDeadline: BigInt(now + 86400),
      captureDeadline: BigInt(now + 172800),
    };
    const domain = {
      name: "PactPay",
      version: "1",
      chainId: 31337,
      verifyingContract: pact.target,
    };
    const signature = await merchant.signTypedData(domain, TYPES, quote);
    const id = ethers.TypedDataEncoder.hash(domain, TYPES, quote);
    await (await pact.createQuote(quote, members, shares, signature)).wait();
    for (const x of signers.slice(1, 3)) {
      await (
        await token.connect(x).approve(pact.target, 100n * 1000000n)
      ).wait();
      await (await pact.connect(x).contribute(id, quote.termsHash)).wait();
    }
    const pkg = {
      schemaVersion: 1,
      chainId: 31337,
      contract: pact.target,
      terms,
      quote,
      members,
      shares,
      signature,
      id,
    };
    fs.writeFileSync(
      "public/sample-quote.json",
      JSON.stringify(
        pkg,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
  }
  console.log(JSON.stringify(deployment, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
