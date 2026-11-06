// Focused keyboard/semantics proof. Native adapter is preparation-only simulated;
// external HTTP is blocked. This script never confirms a wallet request.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require('@playwright/test');
const UI = process.env.PACTPAY_TEST_URL || 'http://127.0.0.1:5173';
const fixture = `
 const address='5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt';
 export const connectNativeWallet=async()=>[{address,name:'Keyboard fixture account'}];
 export const subscribeNativeAccounts=async()=>()=>{};
 export const nativeHistory=()=>[];export const pending=()=>null;
 export async function createNativeAdapter(){return{
 identity:async()=>({specVersion:3002}),health:async()=>({ageMs:0,head:1}),
 account:async()=>({mapped:true,h160:'0x1111111111111111111111111111111111111111',balance:100000000000000n}),
 prepareDeploy:async()=>({fee:100n,storageDeposit:200n}),
 signAndSend:async()=>{window.__signCalls=(window.__signCalls||0)+1;throw Error('Signing forbidden by accessibility proof')}
 }}
`;
(async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});
 const errors=[],external=[];
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url.startsWith(UI+'/src/native/adapter.ts'))return route.fulfill({status:200,contentType:'application/javascript',body:fixture});
   if(url.startsWith(UI)||url.startsWith('data:'))return route.continue();
   external.push(url);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(UI+'/native',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Start your first shared payment'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Agreements',exact:true}).getAttribute('aria-current'),'page');
  const unnamed=await page.locator('button').evaluateAll(nodes=>nodes.filter(n=>!n.disabled&&!n.textContent.trim()&&!n.getAttribute('aria-label')).length);
  assert.equal(unnamed,0);
  const create=page.getByRole('navigation',{name:'Native workspace'}).getByRole('button',{name:'Create agreement',exact:true});
  await create.focus();await page.keyboard.press('Enter');
  await page.getByLabel('Agreement title',{exact:true}).waitFor();
  assert.equal(await create.getAttribute('aria-current'),'page');
  await page.getByLabel('Member 1 share in dUSD',{exact:true}).waitFor();
  const review=page.getByRole('button',{name:'Review agreement creation'});
  assert.equal(await review.isDisabled(),true);
  assert.equal(await review.getAttribute('aria-describedby'),'native-creation-help');
  const summary=page.getByText('Import a shared agreement or backup',{exact:true});
  await summary.focus();await page.keyboard.press('Enter');
  assert.equal(await summary.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');
  const raw=page.getByLabel('Transfer JSON',{exact:true});await raw.fill('{broken');
  await page.getByRole('button',{name:'Preview import',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('alert').waitFor();
  assert.equal(await raw.getAttribute('aria-invalid'),'true');
  assert.ok((await raw.getAttribute('aria-describedby')).includes('native-transfer-error'));
  const backup={schema:'pactpay-transfer-v1',kind:'workspace',deployment:{chainId:420420777,contract:'0x1111111111111111111111111111111111111111',token:'0x2222222222222222222222222222222222222222',codeHash:'0x'+'33'.repeat(32),tokenCodeHash:'0x'+'44'.repeat(32),blockNumber:'1'},agreements:[]};
  await raw.fill(JSON.stringify(backup));assert.equal(await raw.getAttribute('aria-invalid'),null);
  await page.getByRole('button',{name:'Preview import',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Review import',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('pactpay.native.workspace:v1')),null);
  await page.screenshot({path:'evidence/native-accessibility-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'evidence/native-accessibility-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Dismiss import preview'}).focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Connect Polkadot.js',exact:true}).click();
  await page.getByRole('button',{name:'Deployment & test funds',exact:true}).focus();await page.keyboard.press('Enter');
  const estimate=page.getByRole('button',{name:'Estimate token deployment',exact:true});
  await estimate.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(n=>n===document.activeElement),true);
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true);}
  await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Estimate token deployment');
  await estimate.press('Enter');await dialog.waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).press('Enter');await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Estimate token deployment');
  assert.equal(await page.evaluate(()=>window.__signCalls||0),0);
  assert.deepEqual(errors,[]);assert.ok(external.every(url=>url.startsWith('https://fonts.googleapis.com/')));
  // Actual same-origin Chromium Web Locks capability; no adapter operation.
  assert.equal(await page.evaluate(()=>!!navigator.locks),true);
  const lockName='pactpay.native.sign:0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd';
  await page.evaluate(name=>{
   window.__lockAcquired=false;
   window.__heldLock=navigator.locks.request(name,{mode:'exclusive'},async()=>{
    window.__lockAcquired=true;
    await new Promise(resolve=>{window.__releaseLock=resolve});
   });
  },lockName);
  await page.waitForFunction(()=>window.__lockAcquired);
  const other=await context.newPage();await other.goto(UI+'/native',{waitUntil:'networkidle'});
  assert.equal(await other.evaluate(name=>navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>!!lock),lockName),false);
  await page.evaluate(async()=>{window.__releaseLock();await window.__heldLock});
  assert.equal(await other.evaluate(name=>navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>!!lock),lockName),true);
  const proof={checkedAt:new Date().toISOString(),scope:'Rendered native UI; preparation-only simulated adapter; all external HTTP blocked. No deployment, signing or on-chain verification.',checks:['empty workspace named controls','keyboard navigation announces active view','unique member share name','disabled creation linked to prerequisites','summary focus outline','JSON parse error linked to invalid field and cleared on edit','valid local backup preview saves no workspace','390px mobile has no horizontal overflow','review initial focus, Tab/Shift+Tab trap, Escape/cancel return focus','actual same-origin WebLock excludes second page and becomes available after release'],pageErrors:errors,externalRequestsBlocked:external,chainRequests:0,signRequests:0,webLocks:{available:true,secondPageExcluded:true,availableAfterRelease:true},v3:false,realNativeExtension:false};
  fs.writeFileSync('evidence/native-accessibility.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
