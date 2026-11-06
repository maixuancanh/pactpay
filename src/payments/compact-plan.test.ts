import {it,expect} from 'vitest';
import {decodeFunctionData,hashTypedData,parseAbi,type Address} from 'viem';
import {makeQuote,quoteTypedData} from '../features/quotes/schema';
import type {NativeQuotePackage} from '../native/packages';
import {createCompactCallPlan,type CompactSnapshot} from './compact-plan';
const a=('0x'+'11'.repeat(20)) as Address,b=('0x'+'22'.repeat(20)) as Address,escrow=('0x'+'33'.repeat(20)) as Address,token=('0x'+'44'.repeat(20)) as Address;
const terms={title:'Group',description:'Fixed share',merchantName:'Merchant',currency:'dUSD'};
const quote=makeQuote(b,token,terms,[a],[5n],100n,200n,1n);
const pkg:NativeQuotePackage={schema:'pactpay-native-v1',chainId:420420777,contract:escrow,terms,quote,members:[a],shares:[5n],id:hashTypedData(quoteTypedData(420420777,escrow,quote))};
const snap:CompactSnapshot={account:a,chainId:420420777,escrow,quoteId:pkg.id,termsHash:quote.termsHash,state:1,share:5n,contribution:0n,credit:0n,held:0n,now:50n,expiresAt:10000,evidence:'finalized contract read'};
const abi=parseAbi(['function approve(address,uint256) returns(bool)','function contribute(bytes32,bytes32)','function capture(bytes32)','function expire(bytes32)','function claim(bytes32)']);
it('builds exact-share approval + contribute and preserves agreement account ownership',()=>{
 const p=createCompactCallPlan({action:'payment',package:pkg,snapshot:snap,account:a,feePayer:'native',now:0});
 expect(p.calls.map(c=>decodeFunctionData({abi,data:c.data}).functionName)).toEqual(['approve','contribute']);
 expect(decodeFunctionData({abi,data:p.calls[0].data}).args).toEqual([escrow,5n]);
 expect(()=>createCompactCallPlan({action:'payment',package:pkg,snapshot:{...snap,account:b},account:b,feePayer:'native',now:0})).toThrow('Member');
});
it('builds merchant capture/claim, expiry/claim and existing-credit claim plans',()=>{
 const run=(action:'merchant-payout'|'refund',snapshot:CompactSnapshot,account:Address)=>createCompactCallPlan({action,package:pkg,snapshot,account,feePayer:'native',now:0}).calls.map(c=>decodeFunctionData({abi,data:c.data}).functionName);
 expect(run('merchant-payout',{...snap,account:b,share:0n,state:2,held:5n},b)).toEqual(['capture','claim']);
 expect(run('refund',{...snap,now:100n,contribution:5n},a)).toEqual(['expire','claim']);
 expect(run('refund',{...snap,state:5,credit:5n},a)).toEqual(['claim']);
 expect(run('merchant-payout',{...snap,account:b,state:3,credit:5n},b)).toEqual(['claim']);
});
it('rejects modified package, stale snapshot, deadlines, wrong share and no refund credit',()=>{
 for(const patch of [{chainId:1},{share:6n},{expiresAt:0},{now:100n},{contribution:5n}])expect(()=>createCompactCallPlan({action:'payment',package:pkg,snapshot:{...snap,...patch},account:a,feePayer:'native',now:0})).toThrow();
 expect(()=>createCompactCallPlan({action:'payment',package:{...pkg,shares:[6n]},snapshot:snap,account:a,feePayer:'native',now:0})).toThrow();
 expect(()=>createCompactCallPlan({action:'refund',package:pkg,snapshot:{...snap,state:5},account:a,feePayer:'native',now:0})).toThrow();
});
