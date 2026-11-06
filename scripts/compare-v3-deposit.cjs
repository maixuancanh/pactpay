// Read-only V3 estimates. Never loads a signer, signs, or broadcasts.
const fs = require('node:fs');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { encodeDeployData } = require('viem');
const who = '5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt';
const token = '0x85c6d3f215f972459fcc7f816eb4c5733aadcd4a';
const format = n => `${n / 100000000000000n}.${(n % 100000000000000n).toString().padStart(14, '0')}`;
let api;
const timer = setTimeout(() => { console.error('Read-only estimate timed out'); process.exit(2); }, 55000);
(async () => {
  try {
    api = await ApiPromise.create({ provider: new WsProvider('wss://test-node-v3.portaldot.dev'), noInitWarn: true });
    if (api.genesisHash.toHex() !== '0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd') throw Error('Wrong genesis');
    const out = { checkedAt: new Date().toISOString(), signed: false, broadcast: false, who, token, estimates: [] };
    for (const [name, file] of [
      ['before-redesign', 'output/compiler-comparison/baseline-before-redesign.json'],
      ['compact-native', 'public/deploy-artifacts/PactPayNative.json'],
    ]) {
      const art = JSON.parse(fs.readFileSync(file, 'utf8'));
      const code = encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args: [token] });
      const d = await api.call.reviveApi.instantiate(who, 0, null, null, { Upload: code }, '0x', null);
      if (d.result.isErr) throw Error(d.result.asErr.toString());
      if (Number(d.result.asOk.result.flags.bits.toString()) !== 0) throw Error('Constructor reverted');
      const charges = [d.maxStorageDeposit, d.storageDeposit].map(x => x.isCharge ? x.asCharge.toBigInt() : 0n);
      const deposit = charges[0] > charges[1] ? charges[0] : charges[1];
      const weight = { refTime: d.weightRequired.refTime.toBigInt() * 120n / 100n, proofSize: d.weightRequired.proofSize.toBigInt() * 120n / 100n };
      const tx = api.tx.revive.instantiateWithCode(0, weight, deposit.toString(), code, '0x', null);
      const fee = (await tx.paymentInfo(who)).partialFee.toBigInt();
      const row = { name, initCodeBytes: (code.length - 2) / 2, storageDepositTPOT: format(deposit), estimatedFeeTPOT: format(fee), feeBudgetTPOT: format(fee * 120n / 100n), predictedAddress: d.result.asOk.addr.toString() };
      out.estimates.push(row);
      console.log(JSON.stringify(row));
    }
    fs.writeFileSync('evidence/v3-optimization-comparison.json', JSON.stringify(out, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { clearTimeout(timer); if (api) await api.disconnect(); process.exit(process.exitCode || 0); }
})();
