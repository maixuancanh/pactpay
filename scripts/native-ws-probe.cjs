// Read-only comparison: official V3 WebSocket transport, never signs/broadcasts.
const {ApiPromise,WsProvider}=require('@polkadot/api');
const fs=require('node:fs');
const address='5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt';
const result={checkedAt:new Date().toISOString(),endpoint:'wss://test-node-v3.portaldot.dev',signed:false,broadcast:false};
const provider=new WsProvider(result.endpoint,false);let api;
const timer=setTimeout(()=>{console.log('WebSocket probe timeout');process.exit(2)},45000);
(async()=>{try{await provider.connect();api=await ApiPromise.create({provider,noInitWarn:true});result.genesis=api.genesisHash.toHex();result.runtime=(await api.rpc.state.getRuntimeVersion()).specVersion.toNumber();if(result.genesis!=='0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd')throw Error('Wrong genesis');const code=JSON.parse(fs.readFileSync('public/deploy-artifacts/DemoUSD.json')).bytecode;const dry=await api.call.reviveApi.instantiate(address,0,null,null,{Upload:code},'0x',null);result.dryRun=dry.toJSON();console.log(JSON.stringify(result));}catch(e){result.error=String(e.message).split('Failed HTTP Request:')[0].slice(0,400);console.log(JSON.stringify(result));process.exitCode=1}finally{clearTimeout(timer);fs.writeFileSync('evidence/native-ws-probe.json',JSON.stringify(result,null,2));if(api)await api.disconnect();else await provider.disconnect()}})();
