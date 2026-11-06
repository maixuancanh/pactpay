import {useRef,useState} from 'react';
import {createPublicClient,http,formatUnits,type Address,type Hex} from 'viem';
import {verificationNonce} from '../payments/verification-recovery';
import {useAccount} from '../account/AccountProvider';
import {useProtectedWallet} from '../payments/ProtectedWalletBridge';
import {api} from './api';

type Verification={
 account:Address;nativeAddress:string;chainId:number;gas:string;gasPrice:string;
 data:Hex;balance:string;required:string;verified:boolean;
};
export function GoogleWalletVerification(){
 const {session,refresh}=useAccount();
 const provider=useProtectedWallet();
 const [check,setCheck]=useState<Verification|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [recoveryHash,setRecoveryHash]=useState('');
 const running=useRef(false);
 const account=session?.binding?.accountAddress;
 const key='pactpay:eoa-verification:'+account;
 const [saved,setSaved]=useState(()=>localStorage.getItem(key));
 async function run(action:()=>Promise<void>){
  if(running.current)return;
  running.current=true;setBusy(true);setMessage('');
  try{await action();}catch(error){setMessage((error as Error).message);}
  finally{running.current=false;setBusy(false);}
 }
 async function inspect(){
  const value=await api<Verification>('/account/eoa-verification');
  if(value.account.toLowerCase()!==account?.toLowerCase())throw Error('Your account changed. Reconnect the booking wallet.');
  setCheck(value);
  if(value.verified){localStorage.removeItem(key);setSaved(null);await refresh();}
 }
 async function verifyReceipt(){
  const hash=saved==='pending'?recoveryHash.trim():saved;
  if(!hash||!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Enter the verification transaction hash from your wallet activity.');
  await api('/account/eoa-verification','POST',{txHash:hash});
  localStorage.removeItem(key);setSaved(null);await refresh();
 }
 async function submit(reopen=false){
  if(!provider||!account||(!reopen&&saved)||(reopen&&saved!=='pending'))throw Error('Check your wallet and saved transaction first.');
  const fresh=await api<Verification>('/account/eoa-verification');
  const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
  if(fresh.verified){await refresh();return;}
  if(fresh.account.toLowerCase()!==account.toLowerCase()||!accounts.some(a=>a.toLowerCase()===account.toLowerCase())||Number(chain)!==fresh.chainId)throw Error('Wallet or network changed. Check again.');
  if(BigInt(fresh.gas)*BigInt(fresh.gasPrice)>BigInt(fresh.required)||BigInt(fresh.balance)<BigInt(fresh.required))throw Error('The wallet needs more tPOT. Check its balance again.');
  const client=createPublicClient({transport:http('https://test-evm-rpc-v3.portaldot.dev')});
  if(await client.getChainId()!==fresh.chainId)throw Error('Verification network changed.');
  const [latest,pending]=await Promise.all([client.getTransactionCount({address:fresh.account,blockTag:'latest'}),client.getTransactionCount({address:fresh.account,blockTag:'pending'})]);
  const nonce=verificationNonce(latest,pending,localStorage.getItem(key+':nonce'),reopen);
  setCheck(fresh);
  localStorage.setItem(key+':nonce',String(nonce));
  localStorage.setItem(key,'pending');setSaved('pending');
  let hash:Hex;
  try{
   hash=await provider.request({method:'eth_sendTransaction',params:[{
    from:fresh.account,to:fresh.account,value:'0x0',data:fresh.data,nonce:`0x${nonce.toString(16)}`,
    gas:`0x${BigInt(fresh.gas).toString(16)}`,gasPrice:`0x${BigInt(fresh.gasPrice).toString(16)}`,
   }]}) as Hex;
  }catch(error){
   if(typeof error==='object'&&error!==null&&'code' in error&&error.code===4001){
    localStorage.removeItem(key);setSaved(null);
   }
   throw error;
  }
  localStorage.setItem(key,hash);setSaved(hash);
  setMessage('Verification submitted. Wait for finality, then check this transaction.');
 }
 return <section className="pp-wallet-verification" aria-label="Google wallet network verification">
  <h3>Verify your Google wallet on Portaldot</h3>
  <p>Before your first booking payment, confirm one zero-value transaction to your own wallet. The network charges a testnet fee.</p>
  <button type="button" className="pp-secondary" disabled={busy} onClick={()=>void run(inspect)}>Check wallet and verification cost</button>
  {check&&<div>
   <p>Verification cost limit <strong>{formatUnits(BigInt(check.required),18)} tPOT</strong>.</p>
   <p>Available for transactions <strong>{formatUnits(BigInt(check.balance),18)} tPOT</strong>.</p>
   {BigInt(check.balance)<BigInt(check.required)&&<>
    <p>For a new wallet, fund its native address with 0.12 tPOT. This includes the 0.1 tPOT account minimum and a 0.02 tPOT verification budget.</p>
    <p style={{overflowWrap:'anywhere'}}>Native receiving address <strong>{check.nativeAddress}</strong></p>
   </>}
   {!saved&&<button type="button" className="pp-primary" disabled={busy||!provider||BigInt(check.balance)<BigInt(check.required)} onClick={()=>void run(submit)}>Confirm zero-value verification in my wallet</button>}
  </div>}
  {saved&&saved!=='pending'&&<><p style={{overflowWrap:'anywhere'}}>Submitted verification {saved}</p><button type="button" className="pp-secondary" disabled={busy} onClick={()=>void run(verifyReceipt)}>Check finalized verification</button></>}
  {saved==='pending'&&<><p>If the wallet approval disappeared, reopen it here. PactPay checks the original transaction number before requesting another approval.</p><button type="button" className="pp-primary" disabled={busy||!provider} onClick={()=>void run(()=>submit(true))}>Reopen wallet approval</button><details><summary>I already approved: recover my transaction</summary><label>Verification transaction hash<input spellCheck={false} value={recoveryHash} onChange={e=>setRecoveryHash(e.target.value)}/></label><button type="button" className="pp-secondary" disabled={busy||!/^0x[0-9a-f]{64}$/i.test(recoveryHash.trim())} onClick={()=>void run(verifyReceipt)}>Check this verification</button></details></>}
  {busy&&<p role="status">Checking Portaldot…</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
