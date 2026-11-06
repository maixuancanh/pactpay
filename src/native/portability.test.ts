import {describe,it,expect} from 'vitest';
import {hashTypedData,type Address} from 'viem';
import {makeQuote,quoteTypedData} from '../features/quotes/schema';
import {serializeNativePackage} from './packages';
import {receiptBundle,receiptLink} from './receipt-package';
import {createTransferBundle,parseTransferBundle,createShareLink,parseShareFragment,MAX_TRANSFER_BYTES} from './portability';
const merchant=('0x'+'11'.repeat(20)) as Address,token=('0x'+'22'.repeat(20)) as Address,contract=('0x'+'33'.repeat(20)) as Address;
const deployment={chainId:420420777 as const,contract,token,codeHash:('0x'+'44'.repeat(32)) as `0x${string}`,tokenCodeHash:('0x'+'55'.repeat(32)) as `0x${string}`,blockNumber:'1'};
const terms={title:'Cà phê nhóm ☕',description:'Public demonstration terms',merchantName:'Merchant',currency:'dUSD'};
const quote=makeQuote(merchant,token,terms,[merchant],[1000000n],1000n,2000n,1n);
const agreement=serializeNativePackage({schema:'pactpay-native-v1',chainId:420420777,contract,terms,quote,members:[merchant],shares:[1000000n],id:hashTypedData(quoteTypedData(420420777,contract,quote))});
describe('native workspace portability',()=>{
 it('shares a read-only receipt and rejects workspace or altered agreement input',()=>{
  const bundle=createTransferBundle('agreement',deployment,[agreement]);
  const link=new URL(receiptLink('https://pactpay.example/native?secret=removed',bundle));
  expect(link.pathname).toBe('/receipt');expect(link.search).toBe('');
  expect(parseShareFragment(link.hash)).toEqual(bundle);
  expect(()=>receiptBundle(JSON.stringify(createTransferBundle('workspace',deployment,[agreement])))).toThrow(/single agreement/);
  const changed=JSON.parse(agreement);changed.terms.title='altered';
  expect(()=>receiptBundle(JSON.stringify({...bundle,agreements:[JSON.stringify(changed)]}))).toThrow(/modified/);
 });
 it('roundtrips Unicode and exact units in a self-contained fragment without query parameters',()=>{const bundle=createTransferBundle('agreement',deployment,[agreement]);const link=createShareLink('https://pactpay.example/native',bundle);expect(link).not.toContain('?');const parsed=parseShareFragment(new URL(link).hash);expect(parsed?.deployment.contract).toBe(contract);expect(JSON.parse(parsed!.agreements[0]).terms.title).toBe(terms.title);expect(JSON.parse(parsed!.agreements[0]).quote.total).toBe('1000000');});
 it('validates every quote and rejects tampering, duplicates, wrong chain and unexpected sensitive fields',()=>{const bundle=createTransferBundle('workspace',deployment,[agreement]);const bad=JSON.parse(agreement);bad.terms.title='tampered';for(const item of [{...bundle,agreements:[agreement,JSON.stringify(bad)]},{...bundle,agreements:[agreement,agreement]},{...bundle,deployment:{...deployment,chainId:1}},{...bundle,pending:{signed:'0x1234'}},{...bundle,deployment:{...deployment,privateKey:'do-not-import'}}])expect(()=>parseTransferBundle(JSON.stringify(item))).toThrow();});
 it('exports only canonical deployment and quote fields, never pending or signer material',()=>{const bundle=createTransferBundle('workspace',{...deployment,extra:'secret'} as any,[agreement]);expect(JSON.stringify(bundle)).not.toMatch(/secret|signed|privateKey|extra/);expect(parseTransferBundle(JSON.stringify(bundle))).toEqual(bundle);});
 it('bounds backup/URL sizes and rejects malformed fragment without altering other fragments',()=>{expect(()=>parseTransferBundle(' '.repeat(MAX_TRANSFER_BYTES+1))).toThrow(/large/);expect(()=>parseShareFragment('#pactpay=%%%')).toThrow();expect(parseShareFragment('#unrelated')).toBe(null);const bundle=createTransferBundle('workspace',deployment,[]);expect(()=>createShareLink('https://pactpay.example/native',bundle)).toThrow(/agreement/);const hugeTerms={...terms,description:'𠜎'.repeat(4000)};const q=makeQuote(merchant,token,hugeTerms,[merchant],[1n],1000n,2000n,2n);const raw=serializeNativePackage({schema:'pactpay-native-v1',chainId:420420777,contract,terms:hugeTerms,quote:q,members:[merchant],shares:[1n],id:hashTypedData(quoteTypedData(420420777,contract,q))});expect(()=>createTransferBundle('agreement',deployment,[raw])).toThrow();});
 it('allows a configuration-only backup and caps agreement counts before processing',()=>{expect(createTransferBundle('workspace',deployment,[]).agreements).toEqual([]);expect(()=>createTransferBundle('workspace',deployment,Array(51).fill(agreement))).toThrow(/50/);});
 it('keeps a valid large agreement available as a file when it exceeds the link budget',()=>{const t={...terms,description:'漢'.repeat(4000)},q=makeQuote(merchant,token,t,[merchant],[1n],1000n,2000n,3n);const raw=serializeNativePackage({schema:'pactpay-native-v1',chainId:420420777,contract,terms:t,quote:q,members:[merchant],shares:[1n],id:hashTypedData(quoteTypedData(420420777,contract,q))});const bundle=createTransferBundle('agreement',deployment,[raw]);expect(parseTransferBundle(JSON.stringify(bundle)).agreements).toHaveLength(1);expect(()=>createShareLink('https://pactpay.example/native',bundle)).toThrow(/file instead/);});
});
