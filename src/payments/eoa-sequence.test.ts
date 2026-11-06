import {describe,it,expect} from 'vitest';
import ganache from 'ganache';
import {ContractFactory,JsonRpcProvider} from 'ethers';
import {encodeFunctionData,parseAbi,type Address,type EIP1193Provider} from 'viem';
import artifact from '../../artifacts/contracts/DemoUSD.sol/DemoUSD.json';
import {createEoaSequence} from './eoa-sequence';
import {createFlow,executeFlow,reviewFlow} from '../flows/engine';
import type {FlowState} from '../flows/types';
describe('real local EOA sequence',()=>{it.each([{chainId:31337,nativeDecimals:18,feeCap:1000000000000000n},{chainId:420420777,nativeDecimals:14,feeCap:100000000000n}])('sends and verifies the exact two calls with $nativeDecimals native decimals',async({chainId,nativeDecimals,feeCap})=>{
 const server=ganache.server({logging:{quiet:true},chain:{chainId}});await server.listen(0);const address=server.address();if(typeof address==='string'||!address)throw Error('server address');const rpc='http://127.0.0.1:'+address.port;const rpcProvider=new JsonRpcProvider(rpc);try{
 const signer=await rpcProvider.getSigner(0),account=await signer.getAddress() as Address,recipient=await(await rpcProvider.getSigner(1)).getAddress() as Address;const token=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy();await token.waitForDeployment();await(await token.getFunction('mint')(account,100)).wait();const tokenAddress=await token.getAddress() as Address;let sends=0;let journal:FlowState|undefined;
 const provider={request:async(args:{method:string;params?:unknown})=>{if(args.method==='eth_sendTransaction'){expect(journal?.attemptId).toBeTruthy();sends++;}return rpcProvider.send(args.method,Array.isArray(args.params)?args.params:[]);}} as Pick<EIP1193Provider,'request'>;
 const transfer=encodeFunctionData({abi:parseAbi(['function transfer(address,uint256) returns(bool)']),functionName:'transfer',args:[recipient,23n]});
 const sequence=createEoaSequence({rpcUrl:rpc,chainId,account,capability:{verified:true,evidence:'ganache test only',chainId,account},provider,feeCap,storageCap:0n,walletCreationCap:0n,denominationEvidence:'local EVM18',rpcDecimals:18,nativeDecimals,expiresAt:Date.now()+60000,async plan(){return{binding:{account,chainId,escrow:tokenAddress,quoteId:'local-sequence',revision:1,termsHash:'local',recipient,amount:'23',fee:'0',storage:'0',walletCreation:'0',feePayer:'customer',estimateExpiresAt:Date.now()+60000},calls:[{to:tokenAddress,data:encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns(bool)']),functionName:'approve',args:[recipient,23n]}),label:'Exact approval'},{to:tokenAddress,data:transfer,label:'Transfer'}]};},async persist(s){journal=s;},async receipt(){}});
 const initial=createFlow('payment',await sequence.port.preflight());const state=await executeFlow(reviewFlow(initial),sequence.port,()=>{});expect(state.finalized).toBe(true);expect(state.intermediateTransactions).toHaveLength(2);expect(sends).toBe(2);expect(await token.getFunction('balanceOf')(recipient)).toBe(23n);expect(sequence.authorizationCount).toBe(2);
 }finally{rpcProvider.destroy();await server.close();}
},30000);});
