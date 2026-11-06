import {encodeAbiParameters,encodeFunctionData,decodeFunctionResult,encodeDeployData,keccak256,concat,toHex,hashTypedData,recoverTypedDataAddress,type Address,type Hex,type Abi} from 'viem';
import artifact from './pact-account-artifact.json';
import type {NativeAdapter,PreparedNativeTx} from '../native/adapter';
export type AccountCall={target:Address;data:Hex};
const types={Execute:[{name:'callsHash',type:'bytes32'},{name:'relayer',type:'address'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]} as const;
export function accountAuthorization(account:Address,chainId:number,calls:readonly AccountCall[],relayer:Address,nonce:bigint,deadline:bigint){
 if(calls.length<1||calls.length>2||calls.some(c=>c.target.toLowerCase()===account.toLowerCase()))throw Error('Invalid atomic calls');
 const callType=keccak256(toHex('Call(address target,bytes data)'));
 const callsHash=keccak256(concat(calls.map(c=>keccak256(encodeAbiParameters([{type:'bytes32'},{type:'address'},{type:'bytes32'}],[callType,c.target,keccak256(c.data)])))));
 return {domain:{name:'PactPayAccount',version:'1',chainId,verifyingContract:account},types,primaryType:'Execute' as const,message:{callsHash,relayer,nonce,deadline}};
}
export function accountDeployment(owner:Address):Hex{return encodeDeployData({abi:artifact.abi as Abi,bytecode:artifact.bytecode as Hex,args:[owner]});}
export async function prepareSponsoredAccountExecution(input:{adapter:NativeAdapter;sponsorNative:string;sponsorH160:Address;account:Address;owner:Address;chainId:number;calls:readonly AccountCall[];nonce:bigint;deadline:bigint;signature:Hex;maxFee:bigint;maxStorage:bigint}):Promise<PreparedNativeTx>{
 const x=input;if(x.chainId!==420420777||x.deadline<=BigInt(Math.floor(Date.now()/1000)))throw Error('Wrong chain or expired authorization');
 const typed=accountAuthorization(x.account,x.chainId,x.calls,x.sponsorH160,x.nonce,x.deadline);
 const recovered=await recoverTypedDataAddress({...typed,signature:x.signature});if(recovered.toLowerCase()!==x.owner.toLowerCase())throw Error('Wrong account owner signature');
 const actor=await x.adapter.account(x.sponsorNative);if(!actor.mapped||actor.h160.toLowerCase()!==x.sponsorH160.toLowerCase())throw Error('Sponsor mapping mismatch');
 const rawOwner=await x.adapter.readContractData(x.sponsorNative,x.account,encodeFunctionData({abi:accountAbi,functionName:'owner'}));const actualOwner=decodeFunctionResult({abi:accountAbi,functionName:'owner',data:rawOwner}) as Address;
 const rawNonce=await x.adapter.readContractData(x.sponsorNative,x.account,encodeFunctionData({abi:accountAbi,functionName:'nonce'}));const actualNonce=decodeFunctionResult({abi:accountAbi,functionName:'nonce',data:rawNonce}) as bigint;
 if(actualOwner.toLowerCase()!==x.owner.toLowerCase()||actualNonce!==x.nonce)throw Error('Account owner or nonce differs from authorization');
 const data=encodeFunctionData({abi:artifact.abi as Abi,functionName:'execute',args:[x.calls,x.sponsorH160,x.nonce,x.deadline,x.signature]});
 // One runtime call simulates the complete dependent-state batch inside the account.
 // Runtime returns real execution weight/storage for the entire account.execute call.
 const prepared=await x.adapter.prepareCall(x.sponsorNative,x.account,data,'Sponsor reviewed atomic payment');
 if(prepared.fee>x.maxFee||prepared.storageDeposit>x.maxStorage)throw Error('Actual sponsored cost estimate exceeds approved cap');return prepared;
}
export const accountAbi=artifact.abi as Abi;
export const authorizationDigest=(...args:Parameters<typeof accountAuthorization>)=>hashTypedData(accountAuthorization(...args));
