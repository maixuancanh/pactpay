import type {Address,Hex} from 'viem';
export type NativeAtomicCall={to:Address;data:Hex;weight:{refTime:bigint;proofSize:bigint};storageDeposit:bigint};
export type NativeBatchProof={verified:true;evidence:string;account:string;chainId:number;genesis:string;specVersion:number;originPreserved:true;atomicRollback:true;blockHash:Hex;expiresAt:number;calls:NativeAtomicCall[]};
/** A full sequential-state dry run must supply these limits. Summing isolated pre-state estimates is invalid. */
export type NativeBatchSimulator=(input:{account:string;chainId:number;genesis:string;specVersion:number;calls:readonly {to:Address;data:Hex}[]})=>Promise<NativeBatchProof>;
export function assertNativeBatchProof(proof:NativeBatchProof,input:{account:string;chainId:number;genesis:string;specVersion:number;calls:readonly{to:Address;data:Hex}[]},now=Date.now()):void{
 if(!proof.verified||!proof.evidence||!proof.originPreserved||!proof.atomicRollback||proof.account!==input.account||proof.chainId!==input.chainId||proof.genesis!==input.genesis||proof.specVersion!==input.specVersion||proof.expiresAt<=now||!/^0x[0-9a-f]{64}$/i.test(proof.blockHash)||proof.calls.length!==input.calls.length)throw Error('Atomic batch simulation proof unavailable or stale');
 for(let i=0;i<input.calls.length;i++){const expected=input.calls[i],actual=proof.calls[i];if(actual.to.toLowerCase()!==expected.to.toLowerCase()||actual.data.toLowerCase()!==expected.data.toLowerCase()||actual.weight.refTime<=0n||actual.weight.proofSize<0n||actual.storageDeposit<0n)throw Error('Atomic batch proof differs from reviewed calls');}
}
