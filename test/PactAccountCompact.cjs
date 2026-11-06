const {expect}=require('chai');const {ethers}=require('hardhat');
describe('Compact atomic account',()=>{
 async function fixture(independent=false){const [deployer,relay,other]=await ethers.getSigners(),owner=independent?ethers.Wallet.createRandom():deployer,token=await(await ethers.getContractFactory('DemoUSD')).deploy(),factory=await ethers.getContractFactory('PactAccountCompact'),deployTx=await deployer.sendTransaction({data:ethers.concat([factory.bytecode,ethers.zeroPadValue(owner.address,32)])}),deployReceipt=await deployTx.wait(),wallet=factory.attach(deployReceipt.contractAddress);const address=await wallet.getAddress(),target=await token.getAddress();async function envelope(calls,n=0n,deadline=2000000000n,relayer=relay.address){const [a,b]=calls;const suffix=ethers.concat([ethers.zeroPadValue(a.target,32),ethers.toBeHex(ethers.dataLength(a.data),32),ethers.zeroPadValue(b?.target??ethers.ZeroAddress,32),ethers.toBeHex(b?ethers.dataLength(b.data):0,32),a.data,b?.data??'0x']);const domain={chainId:(await ethers.provider.getNetwork()).chainId,verifyingContract:address};const sig=ethers.Signature.from(await owner.signTypedData(domain,{AtomicPayment:[{name:'dataHash',type:'bytes32'},{name:'relayer',type:'address'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},{dataHash:ethers.keccak256(suffix),relayer,nonce:n,deadline}));return ethers.concat([ethers.toBeHex(deadline,32),ethers.toBeHex(n,32),ethers.toBeHex(sig.v,32),sig.r,sig.s,suffix]);}return{owner,relay,other,token,wallet,address,target,envelope};}
 it('binds signatures to relayer, nonce, payload and chain domain; supports one and two calls',async()=>{const a=await fixture();const calls=[{target:a.target,data:a.token.interface.encodeFunctionData('approve',[a.relay.address,100])}];const data=await a.envelope(calls);await expect(a.other.sendTransaction({to:a.address,data})).to.be.reverted;await a.relay.sendTransaction({to:a.address,data});expect(await a.token.allowance(a.address,a.relay.address)).to.equal(100);expect(BigInt(await ethers.provider.getStorage(a.address,0))).to.equal(1);await expect(a.relay.sendTransaction({to:a.address,data})).to.be.reverted;await expect(a.relay.sendTransaction({to:a.address,data:await a.envelope(calls,1n,1n)})).to.be.reverted;});
 it('rolls back approval and nonce when the dependent second call fails',async()=>{const a=await fixture();const calls=[{target:a.target,data:a.token.interface.encodeFunctionData('approve',[a.relay.address,100])},{target:a.target,data:a.token.interface.encodeFunctionData('transfer',[a.relay.address,1])}];await expect(a.relay.sendTransaction({to:a.address,data:await a.envelope(calls)})).to.be.reverted;expect(BigInt(await ethers.provider.getStorage(a.address,0))).to.equal(0);expect(await a.token.allowance(a.address,a.relay.address)).to.equal(0);});
 it('funds actual V1 escrow from account using one owner signature and one relayer transaction',async()=>{const a=await fixture(),escrow=await(await ethers.getContractFactory('PactPay')).deploy(a.target),e=await escrow.getAddress(),coder=ethers.AbiCoder.defaultAbiCoder(),now=(await ethers.provider.getBlock('latest')).timestamp;const q={merchant:a.relay.address,token:a.target,nonce:1,termsHash:ethers.id('terms'),membersHash:ethers.keccak256(coder.encode(['address[]'],[[a.address]])),sharesHash:ethers.keccak256(coder.encode(['uint256[]'],[[10000n]])),total:10000n,fundingDeadline:now+3600,captureDeadline:now+7200};const id=await escrow.quoteDigest(q);await escrow.connect(a.relay).createQuoteNative(q,[a.address],[10000n]);await a.token.mint(a.address,10000);const calls=[{target:a.target,data:a.token.interface.encodeFunctionData('approve',[e,10000])},{target:e,data:escrow.interface.encodeFunctionData('contribute',[id,q.termsHash])}];await a.relay.sendTransaction({to:a.address,data:await a.envelope(calls)});expect(await escrow.contributions(id,a.address)).to.equal(10000);expect(await a.token.allowance(a.address,e)).to.equal(0);});
 it('rejects malformed envelopes, self/EOA targets, native value, altered signatures and trailing bytes',async()=>{const a=await fixture();const call={target:a.target,data:a.token.interface.encodeFunctionData('approve',[a.relay.address,1])},data=await a.envelope([call]);for(const invalid of ['0x1234',ethers.concat([data,'0x00']),data.slice(0,-2)])await expect(a.relay.sendTransaction({to:a.address,data:invalid})).to.be.reverted;await expect(a.relay.sendTransaction({to:a.address,data,value:1})).to.be.reverted;await expect(a.relay.sendTransaction({to:a.address,data:await a.envelope([{...call,target:a.address}])})).to.be.reverted;await expect(a.relay.sendTransaction({to:a.address,data:await a.envelope([{...call,target:a.other.address}])})).to.be.reverted;const changed=ethers.concat([data.slice(0,-2),'0xff']);await expect(a.relay.sendTransaction({to:a.address,data:changed})).to.be.reverted;});
 it('executes V2 contribution and refund with a zero-gas buyer and a separate payer',async()=>{
  const a=await fixture(true);
  const merchant=a.other;
  const escrow=await (await ethers.getContractFactory('PactPayProtected')).deploy(a.target);
  const address=await escrow.getAddress();
  const now=(await ethers.provider.getBlock('latest')).timestamp;
  const terms=ethers.id('Workshop terms');
  const booking=await escrow.connect(merchant).create.staticCall([a.address],[10000n],now+3600,now+7200,60,60,terms);
  await escrow.connect(merchant).create([a.address],[10000n],now+3600,now+7200,60,60,terms);
  await a.token.mint(a.address,10000n);
  expect(await ethers.provider.getBalance(a.owner.address)).to.equal(0n);
  expect(await ethers.provider.getBalance(a.address)).to.equal(0n);
  const call=(name,args)=>({target:address,data:escrow.interface.encodeFunctionData(name,args)});
  const payment=await a.envelope([
   {target:a.target,data:a.token.interface.encodeFunctionData('approve',[address,10000n])},
   call('contribute',[booking]),
  ]);
  await expect(a.relay.sendTransaction({to:a.address,data:payment})).to.emit(escrow,'Funded').withArgs(booking,a.address,10000n);
  await expect(a.relay.sendTransaction({to:a.address,data:payment})).to.be.reverted;
  await escrow.connect(merchant).cancel(booking);
  const refund=await a.envelope([call('settle',[booking,a.address]),call('claim',[])],1n);
  await expect(a.relay.sendTransaction({to:a.address,data:refund})).to.emit(escrow,'Claimed').withArgs(a.address,10000n);
  expect(await a.token.balanceOf(a.address)).to.equal(10000n);
  expect(await escrow.credits(a.address)).to.equal(0n);
  expect(await escrow.totalLiability()).to.equal(0n);
  expect(await ethers.provider.getBalance(a.owner.address)).to.equal(0n);
  expect(await ethers.provider.getBalance(a.address)).to.equal(0n);
 });
});
