import {describe,it,expect,vi} from 'vitest';
import {encodeAbiParameters,slice,hexToBigInt,type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {createCompactFlow,type CompactFlowConfig} from './compact-flow';
import type {CompactPlan} from './compact-plan';
import type {PreparedNativeTx} from '../native/adapter';
const owner=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),account=('0x'+'22'.repeat(20)) as Address,payer=('0x'+'33'.repeat(20)) as Address,escrow=('0x'+'44'.repeat(20)) as Address,hash=('0x'+'55'.repeat(32)) as Hex;
function fixture(){
 const time=1800000000000,events:string[]=[];
 const plan:CompactPlan={binding:{account,chainId:420420777,escrow,quoteId:hash,revision:1,termsHash:hash,recipient:escrow,amount:'5',fee:'0',storage:'0',walletCreation:'0',feePayer:'native',estimateExpiresAt:time+60000},calls:[{target:escrow,data:'0x11223344'},{target:escrow,data:'0xaabbccdd'}]};
 const tx:PreparedNativeTx={id:'one',address:'native',label:'atomic',kind:'call',fee:4n,storageDeposit:2n,weight:{refTime:4n,proofSize:0n},method:'0xabcdef',nonce:8,createdAt:time,startBlock:1,specVersion:3002,genesis:'verified'};
 const c:CompactFlowConfig={account,owner:owner.address,chainId:420420777,feePayer:{native:'native',h160:payer},adapter:{identity:vi.fn(async()=>({chain:'V3',genesis:'0x1234' as Hex,specVersion:3002,decimals:14})),account:vi.fn(async()=>({address:'native',h160:payer,mapped:true,balance:100n,frozen:0n,spendable:100n})),readContractData:vi.fn(async()=>encodeAbiParameters([{type:'address'}],[owner.address])),prepareCall:vi.fn(async()=>{events.push('simulate');return tx;})},readNonce:vi.fn(async()=>7n),signer:{identity:vi.fn(async()=>({account:owner.address,chainId:420420777})),signTypedData:vi.fn(async typed=>{events.push('owner');return owner.signTypedData(typed);})},plan:vi.fn(async()=>plan),feeCap:10n,storageCap:5n,preliminaryEvidence:'Bounded preliminary budget; exact dry-run requires owner signature',expiresAt:time+60000,deadline:BigInt(time/1000+60),reviewFeePayer:vi.fn(async()=>{events.push('payer');return true;}),send:vi.fn(async()=>{events.push('send');return hash;}),confirm:vi.fn(async()=> 'finalized' as const),receipt:vi.fn(async()=>{}),persist:vi.fn(async()=>{}),now:()=>time};
 return {c,p:createCompactFlow(c),plan,tx,events};
}
describe('compact native owner/payer flow',()=>{
 it('reads real nonce, signs once, simulates the entire encoded batch, and requires payer review',async()=>{
  const {c,p,events}=fixture();const b=await p.preflight();expect(c.signer.signTypedData).not.toHaveBeenCalled();expect(c.adapter.prepareCall).not.toHaveBeenCalled();expect(b.fee).toBe('10');
  await p.authorize(b);await p.preflight();expect(c.signer.signTypedData).toHaveBeenCalledTimes(1);
  const call=vi.mocked(c.adapter.prepareCall).mock.calls[0];expect(call[0]).toBe('native');expect(call[1]).toBe(account);expect(hexToBigInt(slice(call[2],32,64))).toBe(7n);expect(call[2].endsWith('11223344aabbccdd')).toBe(true);
  await expect(p.submit(b)).resolves.toBe(hash);expect(events).toEqual(['owner','simulate','payer','send']);await expect(p.submit(b)).rejects.toThrow('Reconcile');
 });
 it.each(['owner','chain','mapping','account','expiry'] as const)('blocks %s mismatch before signing',async mode=>{
  const {c,p,plan}=fixture();if(mode==='owner')c.adapter.readContractData=vi.fn(async()=>encodeAbiParameters([{type:'address'}],[escrow]));
  if(mode==='chain')c.signer.identity=vi.fn(async()=>({account:owner.address,chainId:1}));
  if(mode==='mapping')c.adapter.account=vi.fn(async()=>({address:'native',h160:escrow,mapped:false,balance:100n,frozen:0n,spendable:100n}));
  if(mode==='account')plan.binding.account=escrow;if(mode==='expiry')plan.binding.estimateExpiresAt=0;
  await expect(p.preflight()).rejects.toThrow();expect(c.signer.signTypedData).not.toHaveBeenCalled();
 });
 it('blocks changed calls and nonce after owner authorization',async()=>{
  for(const changed of ['calls','nonce']){const {c,p,plan}=fixture();const b=await p.preflight();await p.authorize(b);if(changed==='calls')plan.calls.reverse();else c.readNonce=vi.fn(async()=>8n);await expect(p.submit(b)).rejects.toThrow('changed');expect(c.send).not.toHaveBeenCalled();}
 });
 it('fails closed on exact simulated costs and never asks payer or sends',async()=>{
  const {c,p,tx}=fixture();tx.fee=11n;const b=await p.preflight();await expect(p.authorize(b)).rejects.toThrow('caps');await expect(p.submit(b)).rejects.toThrow('simulation');expect(c.reviewFeePayer).not.toHaveBeenCalled();expect(c.send).not.toHaveBeenCalled();
 });
 it('blocks replay after ambiguous send and respects manual payer decline',async()=>{
  const a=fixture();a.c.send=vi.fn(async()=>{throw Error('timeout');});const b=await a.p.preflight();await a.p.authorize(b);await expect(a.p.submit(b)).rejects.toThrow('timeout');expect(a.p.submissionState?.().submissionUncertain).toBe(true);await expect(a.p.submit(b)).rejects.toThrow('Reconcile');expect(a.c.send).toHaveBeenCalledTimes(1);
  const d=fixture();d.c.reviewFeePayer=vi.fn(async()=>false);const review=await d.p.preflight();await d.p.authorize(review);await expect(d.p.submit(review)).rejects.toMatchObject({code:4001});expect(d.c.send).not.toHaveBeenCalled();
 });
});
