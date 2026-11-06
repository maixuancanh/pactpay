const {expect}=require('chai');
const {ethers,artifacts}=require('hardhat');
describe('PactPay deployment budget and compact storage',function(){
  it('provides a native-only build without the redundant EVM signature entrypoint',async()=>{
    const a=await artifacts.readArtifact('PactPayNative');
    expect(a.abi.some(x=>x.type==='function'&&x.name==='createQuote')).eq(false);
    expect(a.abi.some(x=>x.type==='function'&&x.name==='createQuoteNativeWithTerms')).eq(true);
    const full=await artifacts.readArtifact('PactPay');
    expect(a.bytecode.length).lessThan(full.bytecode.length);
    expect((a.bytecode.length-2)/2).lessThan(8100);
  });
  it('keeps deployment bytecode below the original 10513 bytes',async()=>{
    const a=await artifacts.readArtifact('PactPay');
    expect((a.bytecode.length-2)/2).to.be.lessThan(10000);
  });
  it('exposes the exact fixed EIP712 domain and binds every quote field',async()=>{
    const t=await(await ethers.getContractFactory('DemoUSD')).deploy();
    const p=await(await ethers.getContractFactory('PactPay')).deploy(t.target);
    const d=await p.eip712Domain();
    expect([...d]).to.deep.equal(['0x0f','PactPay','1',31337n,p.target,ethers.ZeroHash,[]]);
  });
  it('round-trips every public quote field with maximum deadlines and rejects altered digests',async()=>{
    const [merchant,member]=await ethers.getSigners();
    const t=await(await ethers.getContractFactory('DemoUSD')).deploy();
    const p=await(await ethers.getContractFactory('PactPay')).deploy(t.target);
    const coder=ethers.AbiCoder.defaultAbiCoder(),members=[member.address],amounts=[123456789n];
    const q={merchant:merchant.address,token:t.target,nonce:ethers.MaxUint256,termsHash:ethers.id('immutable'),membersHash:ethers.keccak256(coder.encode(['address[]'],[members])),sharesHash:ethers.keccak256(coder.encode(['uint256[]'],[amounts])),total:amounts[0],fundingDeadline:(1n<<64n)-2n,captureDeadline:(1n<<64n)-1n};
    const id=await p.quoteDigest(q);
    await p.createQuoteNative(q,members,amounts);
    const read=await p.getQuote(id);
    expect([...read.terms]).to.deep.equal(Object.values(q));
    expect(read.state).eq(1);expect([...read.members]).deep.eq(members);
    for(const key of ['nonce','total','fundingDeadline','captureDeadline'])expect(await p.quoteDigest({...q,[key]:q[key]-1n})).not.eq(id);
    expect(await p.quoteDigest({...q,token:member.address})).not.eq(id);
  });
});

describe('Native build acceptance and authority',function(){
  it('settles 0.01 dUSD then cancels/refunds a second order without residual liability',async()=>{
    const [merchant,member,other]=await ethers.getSigners();
    const t=await(await ethers.getContractFactory('DemoUSD')).deploy();
    const p=await(await ethers.getContractFactory('PactPayNative')).deploy(t.target);
    await t.mint(member.address,20000n);await t.connect(member).approve(p.target,20000n);
    const coder=ethers.AbiCoder.defaultAbiCoder(),now=(await ethers.provider.getBlock('latest')).timestamp;
    const members=[member.address],amounts=[10000n],terms='Public acceptance terms';
    async function create(nonce){
      const q={merchant:merchant.address,token:t.target,nonce,termsHash:ethers.id(terms),membersHash:ethers.keccak256(coder.encode(['address[]'],[members])),sharesHash:ethers.keccak256(coder.encode(['uint256[]'],[amounts])),total:10000n,fundingDeadline:now+3600,captureDeadline:now+7200};
      const id=await p.quoteDigest(q);
      await expect(p.connect(other).createQuoteNativeWithTerms(q,members,amounts,terms)).revertedWithCustomError(p,'Unauthorized');
      await expect(p.createQuoteNativeWithTerms(q,members,amounts,terms+' altered')).revertedWithCustomError(p,'TermsMismatch');
      await p.createQuoteNativeWithTerms(q,members,amounts,terms);
      const saved=await p.getQuote(id);expect([...saved.terms]).deep.eq(Object.values(q).map(x=>typeof x==='number'?BigInt(x):x));
      await expect(p.createQuoteNative(q,members,amounts)).revertedWithCustomError(p,'NonceUsed');
      await p.connect(member).contribute(id,q.termsHash);return id;
    }
    const paid=await create(1n);
    await expect(p.connect(other).capture(paid)).revertedWithCustomError(p,'Unauthorized');
    await p.capture(paid);expect(await t.balanceOf(merchant.address)).eq(0);
    await p.claim(paid);expect(await t.balanceOf(merchant.address)).eq(10000n);
    const refunded=await create(2n);await p.cancel(refunded);
    await expect(p.connect(other).claim(refunded)).revertedWithCustomError(p,'NothingToClaim');
    await p.connect(member).claim(refunded);expect(await t.balanceOf(member.address)).eq(10000n);
    expect(await t.balanceOf(p.target)).eq(0);expect(await p.totalLiability()).eq(0);
  });
});
