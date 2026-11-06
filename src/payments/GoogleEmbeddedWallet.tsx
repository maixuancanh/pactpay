import { useEffect, useState, useRef, type ReactNode } from 'react';

import { PrivyProvider, usePrivy, useWallets, useCreateWallet, useUser } from '@privy-io/react-auth';

import { defineChain } from 'viem';

const portaldot = defineChain({id:420420777,name:'Portaldot V3',nativeCurrency:{name:'Test POT',symbol:'tPOT',decimals:18},rpcUrls:{default:{http:['https://test-evm-rpc-v3.portaldot.dev']}}});

/** Only public project ID here. Server verifies access tokens and canonical wallet ownership. */

export function GoogleEmbeddedWalletProvider({appId,children}:{appId:string;children:ReactNode}) { return <PrivyProvider appId={appId} config={{loginMethods:['google'],supportedChains:[portaldot],defaultChain:portaldot,embeddedWallets:{ethereum:{createOnLogin:'off'}}}}>{children}</PrivyProvider>; }

export function GoogleEmbeddedWalletSignIn({onAuthenticated,background=false,onStatus}:{onAuthenticated:(accessToken:string)=>Promise<void>;background?:boolean;onStatus?:(value:{busy:boolean;error:string})=>void}) {

 const {ready,authenticated,user,login,logout,getAccessToken}=usePrivy(); const {wallets,ready:walletsReady}=useWallets();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const bound=useRef<string|null>(null);const callback=useRef(onAuthenticated);callback.current=onAuthenticated;

 const {createWallet}=useCreateWallet();const {refreshUser}=useUser();const attempted=useRef<string|null>(null);const [creating,setCreating]=useState(false);const [creationPending,setCreationPending]=useState(false);

 const embedded=wallets.filter(w=>w.walletClientType==='privy'&&w.type==='ethereum');

 useEffect(()=>{setError('');},[user?.id]);

 const linkedWallet=!!user?.linkedAccounts.some(a=>a.type==='wallet'&&a.walletClientType==='privy'&&a.chainType==='ethereum');

 useEffect(()=>{

  if(!ready||!authenticated||!walletsReady||!user?.id||linkedWallet||embedded.length||attempted.current===user.id||sessionStorage.getItem('pactpay:explicit-signout')==='1')return;

  attempted.current=user.id;setCreating(true);setCreationPending(true);setError('');



  void createWallet().then(()=>{setCreationPending(false);setCreating(false);setError('');return refreshUser();}).catch(()=>{setCreating(false);setError('Privy could not complete wallet creation. Check wallet status before retrying; browser privacy settings or the wallet service may be blocking the connection.');});



 },[ready,authenticated,walletsReady,user?.id]);

 useEffect(()=>{if(!creating)return;const timer=setTimeout(()=>{setCreating(false);setError('Wallet creation has not completed. Close any old loading dialog, then check wallet status below. Do not start another wallet creation.');},30000);return()=>clearTimeout(timer);},[creating]);

 async function checkWallet(){setBusy(true);try{const current=await refreshUser();const exists=current.linkedAccounts.some(a=>a.type==='wallet'&&a.walletClientType==='privy'&&a.chainType==='ethereum');setError(exists?'Your wallet exists. Waiting for its secure connection; reload this page if it does not connect.':'No wallet has appeared yet. Keep this account and check again; a timed-out request may still be pending.');}catch{setError('Wallet status could not be checked. Check your connection and try again.');}finally{setBusy(false);}}



 async function bind(){setBusy(true);setError('');try{if(embedded.length!==1)throw Error('A unique existing embedded wallet is required. Recover your wallet before continuing.');const token=await getAccessToken();if(!token)throw Error('Sign in again to restore your session');await callback.current(token);bound.current=user?.id??null;}catch(e){setError(e instanceof Error?e.message:'Wallet restoration failed');}finally{setBusy(false);}}

 useEffect(()=>{if(ready&&authenticated&&walletsReady&&embedded.length===1&&user?.id&&bound.current!==user.id&&sessionStorage.getItem('pactpay:explicit-signout')!=='1'){bound.current=user.id;void bind();}},[ready,authenticated,walletsReady,user?.id,embedded.length]);

 useEffect(()=>{onStatus?.({busy:authenticated&&!error,error:error?'Connection could not finish. Open Connect to check and retry.':''});},[authenticated,error,onStatus]);

 if(background)return null;

 return <section aria-label="Google wallet"><p>Continue with Google to create or restore your embedded wallet. Signing in does not authorize payments.</p>{creating&&<p role="status">Creating your secure wallet…</p>}{authenticated&&(creationPending||linkedWallet)&&embedded.length===0&&<button disabled={busy} onClick={()=>void checkWallet()}>Check wallet status</button>}{!authenticated?<button disabled={!ready} onClick={()=>{sessionStorage.removeItem('pactpay:explicit-signout');login({loginMethods:['google']});}}>Continue with Google</button>:<>{sessionStorage.getItem('pactpay:explicit-signout')==='1'&&<button onClick={()=>{sessionStorage.removeItem('pactpay:explicit-signout');void bind();}}>Continue with Google</button>}<p style={{overflowWrap:'anywhere'}}>{embedded.length===1?embedded[0].address:'Restoring wallet…'}</p><button disabled={!walletsReady||busy||embedded.length!==1} onClick={()=>void bind()}>{busy?'Verifying wallet…':'Continue with this wallet'}</button><button disabled={busy} onClick={()=>void logout()}>Sign out</button></>}{error&&<p role="alert">{error}</p>}</section>;

}
