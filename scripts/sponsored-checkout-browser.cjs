const {chromium}=require('@playwright/test');
const {transform}=require('esbuild');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {privateKeyToAccount}=require('viem/accounts');
const {encodeFunctionData,parseAbi}=require('viem');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const owner=privateKeyToAccount('0x'+'11'.repeat(32)),account='0x'+'22'.repeat(20),relayer='0x'+'33'.repeat(20),token='0x'+'44'.repeat(20),escrow='0x'+'55'.repeat(20),hash='0x'+'66'.repeat(32);
  let job=null,signs=0,submits=0,finalized=false;
  const room={id:'booking',revision:2,termsHash:hash,quote:{chainId:420420777,escrow,quoteId:hash}};
  const contexts=[await browser.newContext({viewport:{width:390,height:844}}),await browser.newContext({viewport:{width:390,height:844}})];for(const context of contexts){
  await context.exposeFunction('fixtureSign',async raw=>{signs++;const typed=JSON.parse(raw);typed.message.nonce=BigInt(typed.message.nonce);typed.message.deadline=BigInt(typed.message.deadline);return owner.signTypedData(typed);});
  let source="import React from '/node_modules/.vite/deps/react.js';\n"+fs.readFileSync('src/payments/SponsoredCompactCheckout.tsx','utf8');
  source=source.replace(/import \{\s*useEffect,\s*useRef,\s*useState\s*\} from 'react';/,'const {useEffect,useRef,useState}=React;').replace("from '@privy-io/react-auth'","from '/__sponsor_sdk.js'").replace("from '../account/AccountProvider'","from '/__sponsor_account.js'").replace("from '../commerce/api'","from '/src/commerce/api.ts'").replace("from './sponsored-port'","from '/src/payments/sponsored-port.ts'").replace("from 'viem'","from '/node_modules/.vite/deps/viem.js'");
  const js=(await transform(source,{loader:'tsx',jsx:'transform'})).code;
  await context.route('**/__sponsor_component.js',r=>r.fulfill({contentType:'application/javascript',body:js}));
  await context.route('**/__sponsor_account.js',r=>r.fulfill({contentType:'application/javascript',body:`export const useAccount=()=>({session:{user:{id:'buyer'},atomicAccount:{accountAddress:'${account}',ownerAddress:'${owner.address}',chainId:420420777}}});`}));
  await context.route('**/__sponsor_sdk.js',r=>r.fulfill({contentType:'application/javascript',body:`const wallet={type:'ethereum',walletClientType:'privy',address:'${owner.address}',getEthereumProvider:async()=>({request:async({method,params})=>method==='eth_accounts'?['${owner.address}']:method==='eth_chainId'?'0x${(420420777).toString(16)}':window.fixtureSign(params[1])})};export const useWallets=()=>({wallets:[wallet]});`}));
  await context.route('**/api/**',r=>{
   const path=new URL(r.request().url()).pathname;let result;
   if(path.endsWith('/sponsorship'))result={available:true,activeIntent:job};
   else if(path.endsWith('/sponsored-intents')&&r.request().method()==='POST'){
    const deadline=String(Math.floor(Date.now()/1000)+120);job={id:'intent',status:'quoted',kind:'payment',account,owner:owner.address,chainId:420420777,relayer,nonce:'0',deadline,calls:[{target:token,data:encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns(bool)']),functionName:'approve',args:[escrow,5000000n]})},{target:escrow,data:encodeFunctionData({abi:parseAbi(['function contribute(bytes32,bytes32)']),functionName:'contribute',args:[hash,hash]})}],binding:{account,chainId:420420777,escrow,quoteId:hash,revision:2,termsHash:hash,recipient:escrow,amount:'5000000',fee:'10000000000000',storage:'500000000000000',walletCreation:'0',feePayer:'merchant-sponsored',estimateExpiresAt:Number(deadline)*1000}};result={intent:job};
   }else if(path.endsWith('/submit')){submits++;assert.deepEqual(Object.keys(r.request().postDataJSON()),['signature']);job={...job,status:'submitted',txHash:hash};result={intent:job};}
   else{if(finalized)job={...job,status:'finalized',actualExecution:'1',actualStorage:'0'};result={intent:job};}
   return r.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await context.route('**/sponsor-fixture',r=>r.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import Checkout from '/__sponsor_component.js';ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Checkout,{room:${JSON.stringify(room)},kind:'payment',onFinalized:()=>{window.finalized=true;}}));</script>`}));
  }
  const first=await contexts[0].newPage(),errors=[];first.on('pageerror',e=>errors.push(e.message));await first.goto('http://127.0.0.1:5173/sponsor-fixture');await first.getByRole('button',{name:'Review my payment',exact:true}).click();await first.getByRole('button',{name:'Confirm this payment in my wallet',exact:true}).click();await first.getByRole('button',{name:'Check payment status',exact:true}).waitFor();
  const second=await contexts[1].newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto('http://127.0.0.1:5173/sponsor-fixture');await second.getByRole('button',{name:'Check payment status',exact:true}).waitFor();assert.equal(signs,1);assert.equal(submits,1);assert.equal(await second.getByRole('button',{name:/Connect.*fee payer/}).count(),0);
  finalized=true;await second.getByRole('button',{name:'Check payment status',exact:true}).click();await second.getByText('Payment action finalized',{exact:true}).waitFor();assert.equal(signs,1);assert.equal(submits,1);assert.deepEqual(errors,[]);console.log('PASS: sponsored checkout signs owner once, no native-wallet step; another isolated browser context resumes server intent and confirms without signing or submitting again. API and wallet fixtures only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
