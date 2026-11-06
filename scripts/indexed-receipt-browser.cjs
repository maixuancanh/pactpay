const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.PACTPAY_TEST_URL || 'http://127.0.0.1:5173';
    const account = '0x' + '11'.repeat(20);
    const escrow = '0x' + '22'.repeat(20);
    const quote = '0x' + '33'.repeat(32);
    let available = false;
    let successfulReads = 0;
    await page.route('**/api/receipts/**', route => {
      assert.equal(route.request().method(), 'GET');
      if (!available) return route.fulfill({status: 503, json: {error: 'temporarily unavailable'}});
      successfulReads++;
      return route.fulfill({json: {
        snapshot: {total: '20000000', state: 3, blockNumber: '100', blockHash: 'fixture',
          positions: [{account, share: '20000000', paid: '10000000', settled: true, disputed: false}]},
        events: [{chain_id: '420420777', escrow, quote_id: quote, kind: 'Settled', tx_hash: 'fixture',
          log_index: 1, block_number: '99', block_hash: 'fixture', source: 'fixture',
          payload: {member: account, refund: '10000000', payout: '0'}}],
      }});
    });
    await page.goto(base + '/receipt?chainId=420420777&escrow=' + escrow + '&quoteId=' + quote);
    await page.getByRole('alert').getByText(/payment status is unknown/i).waitFor();
    available = true;
    await page.getByRole('button', {name: 'Try again'}).click();
    await page.getByRole('heading', {name: 'Individual shares'}).waitFor();
    await page.getByText('Not verified', {exact: true}).waitFor();
    await page.getByRole('heading', {name: 'Share allocated to refund or payout'}).waitFor();
    assert.equal(successfulReads, 1);

    await page.goto(base + '/receipt?example=missing');
    await page.getByRole('heading', {name: 'The booking missed its funding deadline'}).waitFor();
    await page.getByRole('link', {name: 'Related native cancellation refund claim', exact: false}).waitFor();
    await page.getByRole('button', {name: 'Complaint opened'}).click();
    await page.getByRole('heading', {name: 'One share is under review'}).waitFor();
    await page.getByRole('button', {name: 'Everyone paid'}).click();
    await page.getByRole('heading', {name: 'The workshop is fully funded'}).waitFor();
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: anonymous receipt, retry, pooled-claim boundary and all three mobile scenarios (fixture API).');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
