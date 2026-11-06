const fs = require("fs");
const { JsonRpcProvider, Contract, keccak256 } = require("ethers");
(async () => {
  const rpc =
    process.env.PACTPAY_RPC_URL || "https://test-evm-rpc-v3.portaldot.dev";
  const expected = Number(process.env.PACTPAY_CHAIN_ID || 420420777);
  const p = new JsonRpcProvider(rpc);
  const chain = Number((await p.getNetwork()).chainId);
  if (chain !== expected) throw Error("RPC chain mismatch");
  const file = process.env.PACTPAY_DEPLOYMENT_FILE;
  if (!file) {
    console.log(
      JSON.stringify({
        mode: "read-only-preflight",
        chainId: chain,
        block: await p.getBlockNumber(),
        workflowVerified: false,
        message:
          "Set PACTPAY_DEPLOYMENT_FILE to verify an existing deployment; browser /setup signs deployments.",
      }),
    );
    await p.destroy();
    return;
  }
  const d = JSON.parse(fs.readFileSync(file));
  if (d.chainId !== chain) throw Error("Configuration chain mismatch");
  const code = await p.getCode(d.contract);
  if (code === "0x" || keccak256(code) !== d.codeHash)
    throw Error("Contract code mismatch");
  const c = new Contract(
    d.contract,
    [
      "function token() view returns(address)",
      "function totalLiability() view returns(uint256)",
    ],
    p,
  );
  if ((await c.token()).toLowerCase() !== d.token.toLowerCase())
    throw Error("Token binding mismatch");
  const t = new Contract(
    d.token,
    [
      "function decimals() view returns(uint8)",
      "function balanceOf(address) view returns(uint256)",
    ],
    p,
  );
  if ((await t.decimals()) !== 6n) throw Error("Unexpected token decimals");
  const balance = await t.balanceOf(d.contract),
    liability = await c.totalLiability();
  if (balance < liability) throw Error("Insolvent deployment");
  console.log(
    JSON.stringify({
      mode: "read-only-deployment-verification",
      chainId: chain,
      contract: d.contract,
      codeHash: d.codeHash,
      balance: String(balance),
      liability: String(liability),
      workflowVerified: false,
    }),
  );
  await p.destroy();
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
