const fs=require('fs'),path=require('node:path');
fs.mkdirSync('public/deploy-artifacts',{recursive:true});
for(const name of ['DemoUSD','PactPay','PactPayNative']){const base=`artifacts/contracts/${name}.sol/${name}`,a=JSON.parse(fs.readFileSync(base+'.json')),debug=JSON.parse(fs.readFileSync(base+'.dbg.json')),build=JSON.parse(fs.readFileSync(path.resolve(path.dirname(base),debug.buildInfo)));fs.writeFileSync(`public/deploy-artifacts/${name}.json`,JSON.stringify({contractName:name,abi:a.abi,bytecode:a.bytecode,compiler:build.solcVersion,evmVersion:build.input.settings.evmVersion,optimizer:build.input.settings.optimizer}));if(name==='PactPay')fs.writeFileSync('src/lib/pact-abi.json',JSON.stringify(a.abi,null,2));}
console.log('Browser deploy artifacts exported; no network or signing.');
