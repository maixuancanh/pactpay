const {expect}=require('chai');
const {ethers}=require('hardhat');
describe('Atomic wallet primitive local proof only',()=>{
 it('preserves wallet origin and rolls approval back when the second call fails',async()=>{
  const [owner,foreign]=await ethers.getSigners();
  const token=await (await ethers.getContractFactory('DemoUSD')).deploy();
  const wallet=await (await ethers.getContractFactory('AtomicWalletHarness')).deploy();
  const address=await wallet.getAddress(),asset=await token.getAddress();
  const approve=token.interface.encodeFunctionData('approve',[owner.address,100]);
  await wallet.execute([asset],[approve]);
  expect(await token.allowance(address,owner.address)).to.equal(100);
  await expect(wallet.connect(foreign).execute([asset],[approve])).to.be.revertedWith('authority');
  const change=token.interface.encodeFunctionData('approve',[owner.address,200]);
  // An unfunded token transfer fails: preceding approval must disappear atomically.
  const fail=token.interface.encodeFunctionData('transfer',[owner.address,1]);
  await expect(wallet.execute([asset,asset],[change,fail])).to.be.reverted;
  expect(await token.allowance(address,owner.address)).to.equal(100);
 });
});
