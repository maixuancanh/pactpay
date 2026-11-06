const fs = require("fs");
const url = "https://test-evm-rpc-v3.portaldot.dev";
async function rpc(method, params = []) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error("HTTP " + r.status);
  const data = await r.json();
  if (data.error) throw Error(JSON.stringify(data.error));
  return data.result;
}
(async () => {
  const out = {
    checkedAt: new Date().toISOString(),
    mode: "read-only",
    url,
    chainId: parseInt(await rpc("eth_chainId"), 16),
    blockNumber: parseInt(await rpc("eth_blockNumber"), 16),
    clientVersion: await rpc("web3_clientVersion"),
    canaryDeployed: false,
  };
  if (out.chainId !== 420420777) throw Error("Unexpected chain");
  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync("evidence/v3-probe.json", JSON.stringify(out, null, 2));
  console.log(out);
})().catch((e) => {
  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync(
    "evidence/v3-probe.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        mode: "read-only",
        error: e.message,
        canaryDeployed: false,
      },
      null,
      2,
    ),
  );
  console.error(e.message);
  process.exitCode = 1;
});
