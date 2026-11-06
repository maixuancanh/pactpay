// Local-only compiler experiment. Does not replace deploy artifacts or sign transactions.
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const variants = [
  { name: 'legacy-200', viaIR: false, runs: 200 },
  { name: 'legacy-1', viaIR: false, runs: 1 },
  { name: 'ir-1', viaIR: true, runs: 1 },
  { name: 'ir-200', viaIR: true, runs: 200 },
  { name: 'legacy-1-no-inline', viaIR: false, runs: 1, details: { inliner: false } },
  { name: 'legacy-1-no-yul', viaIR: false, runs: 1, details: { yul: false } },
  { name: 'tuple-1', viaIR: false, runs: 1, tuple: true },
  { name: 'tuple-ir-1', viaIR: true, runs: 1, tuple: true },
  { name: 'ir-1-compact', viaIR: true, runs: 1, details: { yulDetails: { optimizerSteps: 'dhfoDgvulfnTUtnf[xa[r]EscLMcCTUtTOntnfDlLculVcul[jmul]VcTOculjmul]:fDnTOcmu' } } },
  { name: 'ir-1-minimal', viaIR: true, runs: 1, details: { yulDetails: { optimizerSteps: 'u' } } },
];
fs.mkdirSync('output/compiler-comparison', { recursive: true });
const rows = [];
for (const variant of variants) {
  if (process.argv[2] && !variant.name.includes(process.argv[2])) continue;
  const settings = {
    evmVersion: 'paris', viaIR: variant.viaIR,
    optimizer: { enabled: true, runs: variant.runs, ...(variant.details ? { details: variant.details } : {}) },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  };
  let source = fs.readFileSync('contracts/PactPay.sol', 'utf8');
  if (variant.tuple) source = source.replace(/abi\.encode\(\s*TYPEHASH,[\s\S]*?q\.captureDeadline\s*\)/, 'abi.encode(TYPEHASH, q)');
  const input = { language: 'Solidity', sources: {
    'contracts/PactPay.sol': { content: source },
  }, settings };
  const result = JSON.parse(solc.compile(JSON.stringify(input), { import: name => {
    try { return { contents: fs.readFileSync(path.join('node_modules', name), 'utf8') }; }
    catch { return { error: 'Missing import: ' + name }; }
  } }));
  const errors = (result.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
  const contract = result.contracts['contracts/PactPay.sol'].PactPay;
  const artifact = { contractName: 'PactPay', abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
    deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
    compiler: solc.version(), settings };
  fs.writeFileSync('output/compiler-comparison/' + variant.name + '.json', JSON.stringify(artifact));
  const row = { ...variant, creationBytes: contract.evm.bytecode.object.length / 2,
    runtimeBytes: contract.evm.deployedBytecode.object.length / 2 };
  rows.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync('output/compiler-comparison/summary' + (process.argv[2] ? '-' + process.argv[2] : '') + '.json', JSON.stringify(rows, null, 2));
