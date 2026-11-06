import {expect,it} from 'vitest';
import {ledgerRow,ledgerCsv,orderReference} from './merchant-ledger';
it('exports historical money evidence with its block and incomplete coverage',()=>{
 const evidence={id:p.id,state:'Captured',merchant:p.quote.merchant,total:10n,merchantCredit:0n,members:[],events:[],finalizedBlock:123n,blockHash:'0xabc',historyCoverage:{status:'partial'},historySource:'native'};
 const row=ledgerRow(p,undefined,1000,[p.id],evidence);expect(row.moneyStatus).toBe('closed-unverified');expect(row.evidenceCoverage).toBe('partial');expect(ledgerCsv([row])).toContain('evidenceBlockHash');expect(row.evidenceBlock).toBe('123');
});
import type {NativeQuotePackage} from './packages';
const p={id:'0x12345678aa',members:['0xmember'],terms:{title:'=HYPERLINK("bad")'},quote:{merchant:'0xmerchant',total:10n,fundingDeadline:100n,captureDeadline:200n}} as unknown as NativeQuotePackage;
it('distinguishes colliding references',()=>{expect(orderReference('0x12345678aa',['0x12345678aa','0x12345678bb'])).not.toBe(orderReference('0x12345678bb',['0x12345678aa','0x12345678bb']));});
it('does not export stale amounts as current or infer paid from zero credit',()=>{const stale=ledgerRow(p,{state:3,held:0n,now:1n,at:1000,merchantCredit:0n},50000,[p.id]);expect(stale.state).toBe('unknown');expect(stale.held).toBe('');const fresh=ledgerRow(p,{state:3,held:0n,now:1n,at:1000,merchantCredit:0n},1001,[p.id]);expect(fresh.action).toBe('Review settlement evidence');});
it('lists credit and expiry tasks and escapes spreadsheet formulas',()=>{const row=ledgerRow(p,{state:3,held:0n,now:1n,at:1000,merchantCredit:2n},1001,[p.id]);expect(row.action).toBe('Claim merchant credit');expect(ledgerCsv([row])).toContain("' =".replace(' ',''));expect(ledgerCsv([row])).toContain('""bad""');expect(ledgerRow(p,{state:1,held:1n,now:100n,at:1000},1001,[p.id]).action).toBe('Process expiry');});
