const { expect } = require("chai");

const { ethers, network } = require("hardhat");

const TYPES = {
  Quote: [
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
    { name: "membersHash", type: "bytes32" },
    { name: "sharesHash", type: "bytes32" },
    { name: "total", type: "uint256" },
    { name: "fundingDeadline", type: "uint64" },
    { name: "captureDeadline", type: "uint64" },
  ],
};

const U = 1000000n;

async function fixture() {
  const [merchant, a, b, c, outsider] = await ethers.getSigners();
  const t = await (await ethers.getContractFactory("DemoUSD")).deploy();
  const p = await (await ethers.getContractFactory("PactPay")).deploy(t.target);
  for (const m of [a, b, c]) {
    await t.mint(m.address, 1000n * U);
    await t.connect(m).approve(p.target, 1000n * U);
  }
  return { merchant, a, b, c, outsider, t, p };
}

async function quote(f, nonce = 1n, opts = {}) {
  const { merchant, a, b, c, t, p } = f;
  const members = [a.address, b.address, c.address];
  const shares = [40n * U, 35n * U, 25n * U];
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const q = {
    merchant: merchant.address,
    token: t.target,
    nonce,
    termsHash: ethers.id("one immutable design workshop"),
    membersHash: ethers.keccak256(coder.encode(["address[]"], [members])),
    sharesHash: ethers.keccak256(coder.encode(["uint256[]"], [shares])),
    total: 100n * U,
    fundingDeadline: now + 1000,
    captureDeadline: now + 2000,
    ...opts,
  };
  const domain = {
    name: "PactPay",
    version: "1",
    chainId: 31337,
    verifyingContract: p.target,
  };
  const sig = await merchant.signTypedData(domain, TYPES, q);
  const id = ethers.TypedDataEncoder.hash(domain, TYPES, q);
  return { q, members, shares, sig, id, domain };
}

async function create(f, n = 1n, o = {}) {
  const x = await quote(f, n, o);
  await f.p.createQuote(x.q, x.members, x.shares, x.sig);
  return x;
}

async function fundAll(f, x) {
  for (const m of [f.a, f.b, f.c])
    await f.p.connect(m).contribute(x.id, x.q.termsHash);
}

async function at(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
}

describe("PactPay — money and authority", function () {
  it("native transaction authentication creates the same digest and completes the money lifecycle", async () => {
    const f = await fixture(), x = await quote(f);
    await expect(f.p.createQuoteNative(x.q, x.members, x.shares))
      .to.emit(f.p, "QuoteCreated").withArgs(x.id, f.merchant.address, x.q.termsHash, x.q.total, x.q.fundingDeadline, x.q.captureDeadline);
    expect((await f.p.getQuote(x.id)).state).eq(1);
    expect(await f.p.usedNonces(f.merchant.address, x.q.nonce)).eq(true);
    await fundAll(f, x);
    await f.p.capture(x.id);
    expect(await f.p.credits(x.id, f.merchant.address)).eq(x.q.total);
    await f.p.claim(x.id);
    expect(await f.t.balanceOf(f.merchant.address)).eq(x.q.total);
    expect(await f.p.totalLiability()).eq(0);
  });

  it("native creation rejects a different sender and mismatched member or amount payload", async () => {
    const f = await fixture(), x = await quote(f);
    await expect(f.p.connect(f.outsider).createQuoteNative(x.q, x.members, x.shares)).revertedWithCustomError(f.p, "Unauthorized");
    await expect(f.p.createQuoteNative(x.q, [...x.members].reverse(), x.shares)).revertedWithCustomError(f.p, "InvalidQuote");
    await expect(f.p.createQuoteNative(x.q, x.members, [1n, ...x.shares.slice(1)])).revertedWithCustomError(f.p, "InvalidQuote");
    expect(await f.p.usedNonces(f.merchant.address, x.q.nonce)).eq(false);
  });

  it("native and EIP712 creation consume one common merchant nonce in either direction", async () => {
    const f = await fixture(), native = await quote(f, 30n);
    await f.p.createQuoteNative(native.q, native.members, native.shares);
    await expect(f.p.createQuote(native.q, native.members, native.shares, native.sig)).revertedWithCustomError(f.p, "NonceUsed");
    await expect(f.p.createQuoteNative(native.q, native.members, native.shares)).revertedWithCustomError(f.p, "NonceUsed");
    const signed = await create(f, 31n);
    await expect(f.p.createQuoteNative(signed.q, signed.members, signed.shares)).revertedWithCustomError(f.p, "NonceUsed");
  });

  it("the original EIP712 entrypoint still rejects empty or wrong signatures", async () => {
    const f = await fixture(), x = await quote(f, 40n);
    await expect(f.p.createQuote(x.q, x.members, x.shares, "0x")).reverted;
    const wrong = await f.outsider.signTypedData(x.domain, TYPES, x.q);
    await expect(f.p.createQuote(x.q, x.members, x.shares, wrong)).revertedWithCustomError(f.p, "BadSignature");
    expect(await f.p.usedNonces(f.merchant.address, x.q.nonce)).eq(false);
    await f.p.createQuoteNative(x.q, x.members, x.shares);
  });

  it("native creation preserves duplicate, zero, deadline and cancellation validation", async () => {
    const f = await fixture();
    const expired = await quote(f, 50n, {fundingDeadline: 1});
    await expect(f.p.createQuoteNative(expired.q, expired.members, expired.shares)).revertedWithCustomError(f.p, "InvalidQuote");
    const x = await quote(f, 51n), coder = ethers.AbiCoder.defaultAbiCoder();
    for (const members of [[f.a.address, f.a.address, f.c.address], [ethers.ZeroAddress, f.b.address, f.c.address]]) {
      const q = {...x.q, membersHash: ethers.keccak256(coder.encode(["address[]"], [members]))};
      await expect(f.p.createQuoteNative(q, members, x.shares)).revertedWithCustomError(f.p, "InvalidQuote");
    }
    await f.p.createQuoteNative(x.q, x.members, x.shares);
    await f.p.connect(f.a).contribute(x.id, x.q.termsHash);
    await f.p.cancel(x.id);
    await f.p.connect(f.a).claim(x.id);
    expect(await f.t.balanceOf(f.a.address)).eq(1000n * U);
    expect(await f.p.totalLiability()).eq(0);
  });

  it("binds TypeScript EIP712 digest, fixed token and 6 decimal units", async () => {
    const f = await fixture();
    const x = await create(f);
    expect(await f.p.quoteDigest(x.q)).eq(x.id);
    expect(await f.t.decimals()).eq(6);
    expect((await f.p.getQuote(x.id)).state).eq(1);
  });

  it("only becomes Ready after every share, capture is credit, claim is actual payment", async () => {
    const f = await fixture(),
      x = await create(f);
    await f.p.connect(f.a).contribute(x.id, x.q.termsHash);
    await f.p.connect(f.b).contribute(x.id, x.q.termsHash);
    expect((await f.p.getQuote(x.id)).state).eq(1);
    await expect(f.p.capture(x.id)).revertedWithCustomError(f.p, "BadState");
    await f.p.connect(f.c).contribute(x.id, x.q.termsHash);
    expect((await f.p.getQuote(x.id)).state).eq(2);
    await f.p.capture(x.id);
    expect(await f.t.balanceOf(f.merchant.address)).eq(0);
    expect(await f.p.credits(x.id, f.merchant.address)).eq(100n * U);
    await f.p.claim(x.id);
    expect(await f.t.balanceOf(f.merchant.address)).eq(100n * U);
    expect(await f.p.totalLiability()).eq(0);
    await expect(f.p.claim(x.id)).revertedWithCustomError(
      f.p,
      "NothingToClaim",
    );
  });

  it("does not confuse approvals, donations or incorrect terms with contributions", async () => {
    const f = await fixture(),
      x = await create(f);
    await f.t.mint(f.p.target, 500n * U);
    expect((await f.p.getQuote(x.id)).held).eq(0);
    await expect(
      f.p.connect(f.a).contribute(x.id, ethers.id("tamper")),
    ).revertedWithCustomError(f.p, "TermsMismatch");
    await expect(
      f.p.connect(f.outsider).contribute(x.id, x.q.termsHash),
    ).revertedWithCustomError(f.p, "NotMember");
    await f.p.connect(f.a).contribute(x.id, x.q.termsHash);
    await expect(
      f.p.connect(f.a).contribute(x.id, x.q.termsHash),
    ).revertedWithCustomError(f.p, "AlreadyContributed");
  });

  it("refunds only contributors independently when collection expires at boundary", async () => {
    const f = await fixture(),
      x = await create(f);
    await f.p.connect(f.a).contribute(x.id, x.q.termsHash);
    await at(x.q.fundingDeadline);
    await f.p.connect(f.outsider).expire(x.id);
    expect(await f.p.credits(x.id, f.a.address)).eq(40n * U);
    await f.p.connect(f.a).claim(x.id);
    expect(await f.t.balanceOf(f.a.address)).eq(1000n * U);
    expect(await f.p.totalLiability()).eq(0);
  });

  it("refunds all after merchant misses capture; capture rejects at exact deadline", async () => {
    const f = await fixture(),
      x = await create(f);
    await fundAll(f, x);
    await at(x.q.captureDeadline);
    await expect(f.p.capture(x.id)).revertedWithCustomError(f.p, "Deadline");
    await f.p.expire(x.id);
    for (const m of [f.a, f.b, f.c]) await f.p.connect(m).claim(x.id);
    expect(await f.p.totalLiability()).eq(0);
  });

  it("permits withdrawal only while Funding and conserves both race orderings", async () => {
    const f = await fixture(),
      x = await create(f);
    await f.p.connect(f.a).contribute(x.id, x.q.termsHash);
    await f.p.connect(f.b).contribute(x.id, x.q.termsHash);
    await f.p.connect(f.a).withdrawContribution(x.id);
    await f.p.connect(f.c).contribute(x.id, x.q.termsHash);
    expect((await f.p.getQuote(x.id)).held).eq(60n * U);
    await f.p.connect(f.a).contribute(x.id, x.q.termsHash);
    await expect(
      f.p.connect(f.b).withdrawContribution(x.id),
    ).revertedWithCustomError(f.p, "BadState");
    expect(await f.p.totalLiability()).eq(100n * U);
  });

  it("rejects signature replay, wrong domain and a merchant changing funded terms", async () => {
    const f = await fixture(),
      x = await create(f);
    await expect(
      f.p.createQuote(x.q, x.members, x.shares, x.sig),
    ).revertedWithCustomError(f.p, "NonceUsed");
    const y = await quote(f, 2n);
    const bad = await f.merchant.signTypedData(
      { ...y.domain, chainId: 420420777 },
      TYPES,
      y.q,
    );
    await expect(
      f.p.createQuote(y.q, y.members, y.shares, bad),
    ).revertedWithCustomError(f.p, "BadSignature");
    await expect(
      f.p.createQuote(
        { ...y.q, total: y.q.total + 1n },
        y.members,
        y.shares,
        y.sig,
      ),
    ).revertedWithCustomError(f.p, "InvalidQuote");
  });

  it("rejects duplicate/zero shares and nonmerchant creation/capture/cancel", async () => {
    const f = await fixture(),
      x = await quote(f);
    await expect(
      f.p.connect(f.a).createQuote(x.q, x.members, x.shares, x.sig),
    ).revertedWithCustomError(f.p, "Unauthorized");
    await expect(
      f.p.createQuote(
        x.q,
        [x.members[0], x.members[0], x.members[2]],
        x.shares,
        x.sig,
      ),
    ).reverted;
    const y = await create(f, 2n);
    await expect(f.p.connect(f.a).cancel(y.id)).revertedWithCustomError(
      f.p,
      "Unauthorized",
    );
    await expect(f.p.connect(f.a).capture(y.id)).revertedWithCustomError(
      f.p,
      "Unauthorized",
    );
  });

  it("cancel Ready creates per-member credit once and new quote cannot spend it", async () => {
    const f = await fixture(),
      x = await create(f);
    await fundAll(f, x);
    await f.p.cancel(x.id);
    await expect(f.p.cancel(x.id)).revertedWithCustomError(f.p, "BadState");
    const y = await create(f, 2n);
    expect((await f.p.getQuote(y.id)).held).eq(0);
    await expect(f.p.capture(y.id)).revertedWithCustomError(f.p, "BadState");
    for (const m of [f.a, f.b, f.c]) await f.p.connect(m).claim(x.id);
    expect(await f.p.totalLiability()).eq(0);
  });

  it("preserves contribution and credit when token transfer fails", async () => {
    const f = await fixture(),
      x = await create(f);
    await f.p.connect(f.a).contribute(x.id, x.q.termsHash);
    await f.p.cancel(x.id);
    await f.t.setTransfersPaused(true);
    await expect(f.p.connect(f.a).claim(x.id)).reverted;
    expect(await f.p.credits(x.id, f.a.address)).eq(40n * U);
    expect(await f.p.totalLiability()).eq(40n * U);
    await f.t.setTransfersPaused(false);
    await f.p.connect(f.a).claim(x.id);
  });

  it("validates duplicate members, zero shares and bad total after matching array hashes", async () => {
    const f = await fixture();
    for (const variant of ["duplicate", "zero", "total"]) {
      const x = await quote(
        f,
        BigInt(10 + ["duplicate", "zero", "total"].indexOf(variant)),
      );
      if (variant === "duplicate") x.members[1] = x.members[0];
      if (variant === "zero") x.shares[0] = 0n;
      const coder = ethers.AbiCoder.defaultAbiCoder();
      x.q.membersHash = ethers.keccak256(
        coder.encode(["address[]"], [x.members]),
      );
      x.q.sharesHash = ethers.keccak256(
        coder.encode(["uint256[]"], [x.shares]),
      );
      if (variant === "total") x.q.total += 1n;
      x.sig = await f.merchant.signTypedData(x.domain, TYPES, x.q);
      await expect(
        f.p.createQuote(x.q, x.members, x.shares, x.sig),
      ).revertedWithCustomError(f.p, "InvalidQuote");
    }
  });

  it("blocks an actual reentrant callback and preserves liability", async () => {
    const [merchant, a, b, c] = await ethers.getSigners();
    const t = await (
      await ethers.getContractFactory("ReentrantToken")
    ).deploy();
    const p = await (
      await ethers.getContractFactory("PactPay")
    ).deploy(t.target);
    const f = { merchant, a, b, c, t, p };
    await t.mint(a.address, 40n * U);
    await t.connect(a).approve(p.target, 40n * U);
    const x = await create(f);
    await p.connect(a).contribute(x.id, x.q.termsHash);
    await p.cancel(x.id);
    await t.arm(p.target, p.interface.encodeFunctionData("claim", [x.id]));
    await p.connect(a).claim(x.id);
    expect(await t.callbackBlocked()).eq(true);
    expect(await p.totalLiability()).eq(0);
    expect(await t.balanceOf(a.address)).eq(40n * U);
  });

  it("conserves token liability over repeated withdraw/recontribute sequences", async () => {
    const f = await fixture(),
      x = await create(f);
    let seed = 771;
    for (let i = 0; i < 20; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const m = [f.a, f.b][seed % 2];
      if ((await f.p.contributions(x.id, m.address)) > 0n)
        await f.p.connect(m).withdrawContribution(x.id);
      else await f.p.connect(m).contribute(x.id, x.q.termsHash);
      expect(await f.t.balanceOf(f.p.target)).eq(await f.p.totalLiability());
    }
    await f.p.cancel(x.id);
    for (const m of [f.a, f.b])
      if ((await f.p.credits(x.id, m.address)) > 0n)
        await f.p.connect(m).claim(x.id);
    expect(await f.p.totalLiability()).eq(0);
  });
});

module.exports = { TYPES, quote, create, fixture };

describe('PactPay recoverable public terms', function () {
  const terms = '{"currency":"dUSD","description":"Public workshop","merchantName":"Studio","title":"Workshop"}';
  it('publishes authenticated exact terms and preserves nonce protection', async () => {
    const f = await fixture(), x = await quote(f, 901n, {termsHash: ethers.id(terms)});
    await expect(f.p.connect(f.outsider).createQuoteNativeWithTerms(x.q,x.members,x.shares,terms)).revertedWithCustomError(f.p,'Unauthorized');
    await expect(f.p.createQuoteNativeWithTerms(x.q,x.members,x.shares,terms)).to.emit(f.p,'TermsPublished').withArgs(x.id,terms);
    expect((await f.p.getQuote(x.id)).state).eq(1);
    await expect(f.p.createQuoteNativeWithTerms(x.q,x.members,x.shares,terms)).revertedWithCustomError(f.p,'NonceUsed');
  });
  it('rejects mismatched, empty, and oversized terms without consuming the nonce', async () => {
    const f = await fixture(), x = await quote(f, 902n, {termsHash: ethers.id(terms)});
    for(const value of [terms+' ', '', 'x'.repeat(16001)])
      await expect(f.p.createQuoteNativeWithTerms(x.q,x.members,x.shares,value)).reverted;
    expect(await f.p.usedNonces(f.merchant.address,x.q.nonce)).eq(false);
    const large = 'é'.repeat(8001), y=await quote(f,903n,{termsHash:ethers.id(large)});
    await expect(f.p.createQuoteNativeWithTerms(y.q,y.members,y.shares,large)).reverted;
  });
  it('keeps zero and duplicate member rejection on the recoverable entrypoint', async () => {
    const f = await fixture(), x=await quote(f,904n,{termsHash:ethers.id(terms)}), coder=ethers.AbiCoder.defaultAbiCoder();
    for(const members of [[ethers.ZeroAddress,...x.members.slice(1)],[x.members[0],x.members[0],x.members[2]]]) {
      const q={...x.q,membersHash:ethers.keccak256(coder.encode(['address[]'],[members]))};
      await expect(f.p.createQuoteNativeWithTerms(q,members,x.shares,terms)).revertedWithCustomError(f.p,'InvalidQuote');
    }
  });
});
