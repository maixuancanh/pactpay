// Native wallet transport is simulated; all contract transactions execute on an isolated local EVM.
const fs=require('node:fs'),assert=require('node:assert/strict');
const ganache=require('ganache');
const {chromium}=require('@playwright/test');
const {ethers}=require('ethers');
const SS58='5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt';
const RPC='http://127.0.0.1:19145';
async function rpc(method,params=[]){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:1,jsonrpc:'2.0',method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result}
(async()=>{
 const server=ganache.server({chain:{chainId:420420777,hardfork:'shanghai'},wallet:{deterministic:true},logging:{quiet:true}});await server.listen(19145,'127.0.0.1');
 const accounts=await rpc('eth_accounts'),actor=accounts[0];let browser,demoContext,demoVideo,deployCount=0,failTokenReadback=false,readbackFailures=0;
 const fixture=`
 const address=${JSON.stringify(SS58)},actor=${JSON.stringify(actor)};const KEY='native-fixture-pending';
 async function rpc(method,params=[]){const r=await fetch('https://test-evm-rpc-v3.portaldot.dev',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:1,jsonrpc:'2.0',method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result}
 export const connectNativeWallet=async()=>[{address,name:'Test native account',source:'polkadot-js-fixture'}];
 export const subscribeNativeAccounts=async(cb)=>{window.__nativeAccounts=cb;return()=>{window.__nativeAccounts=null}};
 export const nativeHistory=s=>JSON.parse(s.getItem('fixture-native-history')||'[]');
 const history=(s,row)=>s.setItem('fixture-native-history',JSON.stringify([row,...nativeHistory(s).filter(x=>x.id!==row.id)]));
 export const pending=s=>JSON.parse(s.getItem(KEY)||'null');
 const account=async(a)=>{if(a!==address)throw Error('Unknown fixture native account');return{address,h160:actor,mapped:true,balance:50000000000000000n,frozen:0n,spendable:49990000000000000n}};
 export async function createNativeAdapter(){return{identity:async()=>({chain:'Local EVM fixture',specVersion:3002,decimals:14}),health:async()=>({ageMs:0,head:1,finalized:1}),account,disconnect:async()=>{},
 prepareDeploy:async(a,data,label)=>(window.__nativeAccounts?.([{address:a,name:'Repeated metadata',source:'polkadot-js-fixture'}]),{id:crypto.randomUUID(),address:a,kind:'deploy',data,label,fee:100n,storageDeposit:200n,weight:{refTime:1n,proofSize:1n}}),
 prepareCall:async(a,to,data,label)=>({id:crypto.randomUUID(),address:a,kind:'call',to,data,label,fee:100n,storageDeposit:200n,weight:{refTime:1n,proofSize:1n}}),
 signAndSend:async(p,s)=>{if(window.__rejectOnce){window.__rejectOnce=false;throw Error('Fixture user rejected signature')}s.setItem(KEY,JSON.stringify({id:p.id,label:p.label,status:'awaiting-signature'}));const hash=await rpc('eth_sendTransaction',[{from:actor,to:p.to,data:p.data,gas:'0xb71b00'}]);let r;for(let i=0;i<100;i++){r=await rpc('eth_getTransactionReceipt',[hash]);if(r)break;await new Promise(resolve=>setTimeout(resolve,50))}if(!r||r.status!=='0x1')throw Error('Local contract reverted');const result={hash,blockHash:r.blockHash,contractAddress:r.contractAddress};s.setItem(KEY,JSON.stringify({id:p.id,label:p.label,status:'finalized',result}));return result},
 acknowledge:(s,result)=>{const row=pending(s);if(row?.status!=='finalized'||row.result.hash!==result.hash||row.result.blockHash!==result.blockHash)throw Error('Acknowledgement mismatch');history(s,{id:row.id,label:row.label,address,status:'finalized',hash:result.hash,blockHash:result.blockHash,createdAt:Date.now()});s.removeItem(KEY)},
 recover:async(s)=>{const row=pending(s);if(row?.status!=='finalized')throw Error('Fixture has no finalized recovery intent');return row.result}}}
 `;
 try{
  const recording=process.env.PACTPAY_RECORD_DEMO==='1';browser=await chromium.launch({headless:false,channel:'chrome',slowMo:recording?180:0});demoContext=await browser.newContext({viewport:{width:1440,height:1000},...(recording?{recordVideo:{dir:'output/demo/raw',size:{width:1440,height:1000}}}:{})});const page=await demoContext.newPage(),errors=[];demoVideo=recording?page.video():null;if(recording)await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const badge=document.createElement('div');badge.textContent='LOCAL DEMO | Simulated Polkadot.js transport | Real isolated contracts | No V3 transaction';badge.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#102e2a;color:#fff;padding:10px 20px;font:15px sans-serif;text-align:center;pointer-events:none';document.body.append(badge)}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/native/adapter.ts*',r=>r.fulfill({status:200,contentType:'application/javascript',body:fixture}));
  await page.route('https://test-evm-rpc-v3.portaldot.dev/**',async route=>{const body=route.request().postData(),j=JSON.parse(body);if(j.method==='eth_sendTransaction'&&!j.params[0].to){deployCount++;if(deployCount===1)failTokenReadback=true;}if(j.method==='eth_getCode'&&failTokenReadback){readbackFailures++;await route.fulfill({status:503,contentType:'text/plain',body:'Fixture finalized-token readback unavailable'});return;}const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body});await route.fulfill({status:200,contentType:'application/json',body:await response.text()})});
  await page.goto('http://127.0.0.1:5173/native',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Connect Polkadot.js',exact:true}).click();
  await page.getByText('Native wallet connected. Review each action before signing.').waitFor();
  await page.getByRole('button',{name:'Deployment & test funds',exact:true}).click();
  async function sign(){await page.getByRole('button',{name:'Confirm in Polkadot.js',exact:true}).click();await page.locator('.native-working').waitFor({state:'hidden'});const e=await page.locator('.native-error').allTextContents();assert.equal(e.length,0,e.join('\n'))}
  await page.getByRole('button',{name:'Estimate token deployment',exact:true}).click();await page.evaluate(()=>window.__nativeAccounts([{address:'5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt',name:'Renamed account',source:'polkadot-js-fixture'}]));await page.getByRole('dialog').waitFor();await page.evaluate(()=>{window.__rejectOnce=true});await page.getByRole('button',{name:'Confirm in Polkadot.js',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture user rejected signature'}).waitFor();
  await page.getByText('Export troubleshooting information',{exact:true}).click();const diagnosticDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download diagnostics',exact:true}).click();const diagnostic=JSON.parse(fs.readFileSync(await(await diagnosticDownload).path(),'utf8'));assert.equal(diagnostic.actionCode,'deploy');assert.equal(diagnostic.runtimeVersion,3002);assert.equal(diagnostic.errorCode,'WALLET_REJECTED');assert.ok(!JSON.stringify(diagnostic).includes('Fixture user rejected'));assert.equal(diagnostic.transactionHash,undefined);
  await page.getByRole('button',{name:'Estimate token deployment',exact:true}).click();await page.getByRole('button',{name:'Confirm in Polkadot.js',exact:true}).click();
  await page.locator('.native-error').waitFor();await page.locator('.native-working').waitFor({state:'hidden'});assert.equal(deployCount,1);assert.ok(readbackFailures>0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('native-fixture-pending')).status),'finalized');
  failTokenReadback=false;await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Connect Polkadot.js',exact:true}).click();await page.getByText('Native wallet connected. Review each action before signing.').waitFor();
  await page.getByRole('button',{name:'Check transaction',exact:true}).click();await page.locator('.native-working').waitFor({state:'hidden'});
  assert.equal(deployCount,1,'Recovered deployment must not send a second deploy');assert.equal(await page.evaluate(()=>localStorage.getItem('native-fixture-pending')),null);assert.ok(await page.evaluate(()=>localStorage.getItem('pactpay.native.token')));
  await page.getByRole('button',{name:'Estimate escrow deployment',exact:true}).click();await sign();
  await page.getByRole('button',{name:'Review demo mint',exact:true}).click();await sign();
  await page.getByRole('button',{name:'Create agreement',exact:true}).click();
  await page.getByLabel('Agreement title',{exact:true}).fill('Native wallet shared workshop');await page.getByLabel('Merchant name',{exact:true}).fill('Fixture Merchant');
  await page.getByLabel('What everyone is paying for').fill('Local contract E2E with simulated native signing.');
  await page.getByRole('button',{name:'Review agreement creation',exact:false}).click();await page.getByRole('dialog').waitFor();
  await page.getByLabel('Agreement title',{exact:true}).evaluate(el=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'Changed during review');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByLabel('Agreement title',{exact:true}).fill('Native wallet shared workshop');await page.getByRole('button',{name:'Review agreement creation',exact:false}).click();await sign();
  await page.getByRole('button',{name:'1. Approve exact share',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'1. Approve exact share',exact:true}).click();await sign();
  await page.getByRole('button',{name:'Revoke token approval',exact:true}).click();await sign();assert.equal(await page.getByRole('button',{name:'2. Contribute 10 dUSD',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'1. Approve exact share',exact:true}).click();await sign();
  await page.getByRole('button',{name:'2. Contribute 10 dUSD',exact:true}).click();await sign();
  await page.getByRole('button',{name:'Capture collection',exact:true}).click();await sign();
  await page.getByRole('button',{name:'Claim 10 dUSD',exact:true}).click();await sign();
  await page.getByRole('button',{name:'Verify selected order snapshot',exact:true}).click();await page.getByRole('button',{name:'Download verified snapshot',exact:true}).waitFor();await page.getByRole('region',{name:'Payment timeline'}).getByText('Merchant payout transferred',{exact:true}).waitFor();
  const paidCsvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export merchant CSV',exact:true}).click();const paidCsv=fs.readFileSync(await(await paidCsvDownload).path(),'utf8');assert.ok(paidCsv.includes('payout-verified'));assert.ok(paidCsv.includes('"complete"'));
  await page.getByRole('button',{name:'Activity',exact:true}).click();await page.getByRole('heading',{name:'Wallet activity',exact:true}).waitFor();assert.ok(await page.getByText('finalized',{exact:true}).count()>0);
  await page.getByRole('button',{name:'Deployment & test funds',exact:true}).click();await page.getByRole('button',{name:'Review demo mint',exact:true}).click();await page.evaluate(()=>window.__nativeAccounts([]));await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Review demo mint',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Connect Polkadot.js',exact:true}).click();await page.getByText('Native wallet connected. Review each action before signing.').waitFor();await page.getByRole('button',{name:'Disconnect wallet',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Review demo mint',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Connect Polkadot.js',exact:true}).click();await page.getByText('Native wallet connected. Review each action before signing.').waitFor();await page.getByRole('button',{name:'Agreements',exact:true}).click();
  const config=await page.evaluate(()=>JSON.parse(localStorage.getItem('pactpay.native.config.v1')));
  const provider=new ethers.JsonRpcProvider(RPC),token=new ethers.Contract(config.token,['function balanceOf(address) view returns(uint256)'],provider),pact=new ethers.Contract(config.contract,['function totalLiability() view returns(uint256)'],provider);
  assert.equal(await token.balanceOf(actor),100000000n);assert.equal(await token.balanceOf(config.contract),0n);assert.equal(await pact.totalLiability(),0n);
  await page.screenshot({path:'evidence/native-browser-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'evidence/native-browser-mobile.png',fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);assert.deepEqual(errors,[]);
  const evidence={checkedAt:new Date().toISOString(),mode:'simulated native wallet transport with actual isolated local EVM contracts',chainId:420420777,realNativeExtension:false,v3:false,flows:['connect','rejected signature then retry','deploy token','finalized deployment readback503 followed by reload/recover/acknowledge without resend','deploy escrow','mint100','create1member native-authorized quote','approve10','revoke allowance to0 and approve again','contribute10','capture10','claim10','activity history','permission removal invalidates in-flight review','disconnect and reconnect'],recovery:{tokenDeployBroadcastCount:1,forcedReadbackFailures:readbackFailures,totalDeploymentBroadcasts:deployCount},final:{walletDemoUSD:'100',escrowDemoUSD:'0',totalLiability:'0'},pageErrors:errors,mobileOverflow:overflow};fs.writeFileSync('evidence/native-browser.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await provider.destroy();
 }finally{if(demoContext)await demoContext.close();if(demoVideo){fs.mkdirSync('output/demo',{recursive:true});await demoVideo.saveAs('output/demo/pactpay-local-workflow.webm');}if(browser)await browser.close();await server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
