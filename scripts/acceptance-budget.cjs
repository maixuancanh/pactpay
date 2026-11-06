// Local state fixtures + read-only V3 state overrides. No real wallet/signature/broadcast.
const fs=require('node:fs');
const ganache=require('ganache');
const {ethers}=require('ethers');
const {ApiPromise,WsProvider}=require('@polkadot/api');
const WHO='5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt';
const ACTOR='0x9e9c796039a48295676265b2e2d62fb2782f56a0';
const TOKEN='0x85c6d3f215f972459fcc7f816eb4c5733aadcd4a';
const ESCROW='0x7c6b401e925d36305e96c3f5472d2bad67a6cc65';
const fmt=n=>ethers.formatUnits(BigInt(n),14);
const artifact=n=>JSON.parse(fs.readFileSync(`artifacts/contracts/${n}.sol/${n}.json`));
let api,local;
const timer=setTimeout(()=>{console.error('Budget probe timed out');process.exit(2)},180000);
(async()=>{try{
 api=await ApiPromise.create({provider:new WsProvider('wss://test-node-v3.portaldot.dev'),noInitWarn:true});
 if(api.genesisHash.toHex()!=='0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd')throw Error('Wrong V3 genesis');
 const finalized=await api.rpc.chain.getFinalizedHead(),at=await api.at(finalized);
 const actorMapping=(await at.call.reviveApi.address(WHO)).toString();if(actorMapping.toLowerCase()!==ACTOR)throw Error('Mapping mismatch');
 const now=Number((await at.query.timestamp.now()).toString())/1000;
 local=ganache.provider({chain:{chainId:420420777,time:new Date(now*1000)},wallet:{unlockedAccounts:[ACTOR]},logging:{quiet:true}});
 const rpc=(method,params=[])=>local.request({method,params});
 const provider=new ethers.BrowserProvider(local),signer=await provider.getSigner(ACTOR);
 await rpc('evm_setAccountBalance',[ACTOR,'0x100000000000000000000']);
 const ta=artifact('DemoUSD'),pa=artifact('PactPayNative');
 const tempToken=await new ethers.ContractFactory(ta.abi,ta.bytecode,signer).deploy();await tempToken.waitForDeployment();
 await rpc('evm_setAccountCode',[TOKEN,await provider.getCode(tempToken.target)]);
 const keys=new Set(Array.from({length:13},(_,i)=>ethers.toBeHex(i,32)));
 for(const key of keys){const value=await provider.getStorage(tempToken.target,key);await rpc('evm_setAccountStorageAt',[TOKEN,key,value]);}
 const tempPact=await new ethers.ContractFactory(pa.abi,pa.bytecode,signer).deploy(TOKEN);await tempPact.waitForDeployment();
 await rpc('evm_setAccountCode',[ESCROW,await provider.getCode(tempPact.target)]);
 for(const key of keys){const value=await provider.getStorage(tempPact.target,key);await rpc('evm_setAccountStorageAt',[ESCROW,key,value]);}
 const token=new ethers.Contract(TOKEN,ta.abi,signer),pact=new ethers.Contract(ESCROW,pa.abi,signer);
 async function overrides(){const rows={};for(const address of [TOKEN,ESCROW]){const state={};for(const key of keys){const raw=await rpc('eth_getStorageAt',[address,key,'latest']),value=raw==='0x'?'0x0':raw;if(BigInt(value))state[key]=ethers.toBeHex(BigInt(value),32);}rows[address]={code:await rpc('eth_getCode',[address,'latest']),storage:{State:state}};}return rows;}
 // V3 charges 32-byte slot key + 32-byte value. Calibrate against live mint below.
 const perSlot=api.consts.revive.depositPerByte.toBigInt()*64n+api.consts.revive.depositPerChildTrieItem.toBigInt();
 const out={checkedAt:new Date().toISOString(),mode:'Local EVM storage-write model using live V3 deposit constants; not V3 per-step dry-run proof',realSigned:false,realBroadcast:false,finalizedBlock:finalized.toHex(),nativeAddress:WHO,amountPerOrderDUSD:'0.01',sameAccountMerchantAndMember:true,perNewSlotModelTPOT:fmt(perSlot),steps:[]};
 async function step(label,contract,method,args){
  const data=contract.interface.encodeFunctionData(method,args);
  const pre=await overrides();
  const receipt=await(await contract[method](...args,{gasLimit:12000000})).wait();
  const trace=await rpc('debug_traceTransaction',[receipt.hash,{disableMemory:true,disableStorage:true}]);
  let newSlots=0;const state={};
  for(const log of trace.structLogs||[])if(log.op==='SSTORE'){
    const address=log.depth===1?contract.target:TOKEN,key='0x'+log.stack.at(-1).padStart(64,'0'),value=BigInt('0x'+log.stack.at(-2));keys.add(key);
    const identity=address.toLowerCase()+key;
    const old=state[identity]??BigInt(pre[address]?.storage.State[key]||'0x0');
    if(old===0n&&value!==0n)newSlots++;
    state[identity]=value;
  }
  const row={label,newNonzeroSlotWrites:newSlots,storageDepositModelTPOT:fmt(BigInt(newSlots)*perSlot),localGasUsed:receipt.gasUsed.toString()};out.steps.push(row);console.log(JSON.stringify(row));
 }
 await step('Mint 0.03 dUSD',token,'mint',[ACTOR,30000n]);
 const coder=ethers.AbiCoder.defaultAbiCoder(),members=[ACTOR],amounts=[10000n];
 const terms='{"currency":"dUSD","description":"V3 acceptance","merchantName":"PactPay","title":"Test"}';
 async function quote(nonce){const q={merchant:ACTOR,token:TOKEN,nonce,termsHash:ethers.keccak256(ethers.toUtf8Bytes(terms)),membersHash:ethers.keccak256(coder.encode(['address[]'],[members])),sharesHash:ethers.keccak256(coder.encode(['uint256[]'],[amounts])),total:10000n,fundingDeadline:BigInt(Math.floor(now)+3600),captureDeadline:BigInt(Math.floor(now)+7200)};const id=await pact.quoteDigest(q);await step('Create order '+nonce,pact,'createQuoteNativeWithTerms',[q,members,amounts,terms]);return{id,q};}
 const first=await quote(90001n);
 await step('Approve 0.03 dUSD for three fixture contributions',token,'approve',[ESCROW,30000n]);
 await step('Contribute order 1',pact,'contribute',[first.id,first.q.termsHash]);
 await step('Capture order 1',pact,'capture',[first.id]);
 await step('Claim merchant payment',pact,'claim',[first.id]);
 const second=await quote(90002n);
 await step('Contribute order 2',pact,'contribute',[second.id,second.q.termsHash]);
 await step('Cancel order 2',pact,'cancel',[second.id]);
 await step('Claim refund',pact,'claim',[second.id]);
 const third=await quote(90003n);
 await step('Contribute order 3',pact,'contribute',[third.id,third.q.termsHash]);
 await rpc('evm_increaseTime',[7201]);
 await rpc('evm_mine');
 await step('Expire uncaptured order 3',pact,'expire',[third.id]);
 await step('Claim expiry refund',pact,'claim',[third.id]);
 if(await pact.totalLiability()!==0n)throw Error('Fixture left escrow liabilities');
 out.storageDepositModelSumTPOT=fmt(out.steps.reduce((n,s)=>n+ethers.parseUnits(s.storageDepositModelTPOT,14),0n));
 const mintData=token.interface.encodeFunctionData('mint',[ACTOR,30000n]);
 const mint=await at.call.reviveApi.call(WHO,TOKEN,0,null,null,mintData);
 if(mint.result.isErr)throw Error('Live mint dry-run: '+mint.result.asErr.toString());
 if(Number(mint.result.asOk.flags.bits.toString())!==0)throw Error('Live mint reverted');
 out.liveMintCalibration={maxStorageDepositTPOT:fmt(mint.maxStorageDeposit.isCharge?mint.maxStorageDeposit.asCharge.toBigInt():0n),modelTPOT:out.steps[0].storageDepositModelTPOT};
 out.caveats=['Local storage-write model, not deployed V3 escrow or wallet acceptance.','Counts all zero-to-nonzero writes without relying on refunds. Runtime overhead may differ.','Future per-step native fees are not measured; reserve an explicit fee margin.','V3 state-overridden end-to-end probe was rejected with Invalid call: Payment; no result claimed.','Balances/nonce/code existence and exact deposit/fee must be rechecked before each real signature.'];
 fs.writeFileSync('evidence/v3-acceptance-budget.json',JSON.stringify(out,null,2));console.log(JSON.stringify({storageDepositModelSumTPOT:out.storageDepositModelSumTPOT,liveMintCalibration:out.liveMintCalibration}));
}catch(e){console.error(e);process.exitCode=1;}finally{clearTimeout(timer);if(api)await api.disconnect();if(local)await local.disconnect();process.exit(process.exitCode||0);}})();
