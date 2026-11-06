import {useEffect,useState,lazy,Suspense} from 'react';

import {isAddress,type Address,type Hex} from 'viem';

import {ProtectedBookingPage} from './ProtectedBookingPage';

import {AccountProvider,useAccount} from '../account/AccountProvider';

const ProtectedWalletWorkspace=lazy(()=>import('./ProtectedWalletWorkspace'));
const ProtectedNativeCreate=lazy(()=>import('./ProtectedNativeCreate'));
const ProtectedNativeContribution=lazy(()=>import('./ProtectedNativeContribution'));

import type {ProtectedDeployment} from './protected-adapter';

export default function ProtectedRoute(){return <AccountProvider><Route/></AccountProvider>;}

function Route(){const {config}=useAccount();

 const [deployment,setDeployment]=useState<ProtectedDeployment|null>(null),[message,setMessage]=useState('Loading protected booking configuration…');

 const p=new URLSearchParams(location.search),quote=p.get('quote')??'',member=p.get('member')??'';

 useEffect(()=>{let active=true;fetch('/api/config').then(r=>{if(!r.ok)throw Error('Booking service unavailable');return r.json();}).then(c=>{if(!active)return;if(!c.capabilities?.protectedContract||!c.protectedDeployment){setMessage('Protected settlement is awaiting a verified V2 deployment. Existing orders remain available in your wallet workspace.');return;}const d=c.protectedDeployment;if(d.version!=='protected-v2'||!Number.isSafeInteger(d.chainId)||d.chainId<=0||!isAddress(d.address)||typeof d.rpcUrl!=='string'||!/^https?:\/\//.test(d.rpcUrl)||!/^\d+$/.test(String(d.deploymentBlock)))throw Error('Invalid protected deployment configuration');setDeployment({...d,deploymentBlock:BigInt(d.deploymentBlock)});}).catch(()=>{if(active)setMessage('Protected booking configuration could not be loaded. Try again when the booking service is available.');});return()=>{active=false;};},[]);

 if(deployment?.chainId===420420777&&p.get('wallet')==='native'&&/^0x[0-9a-fA-F]{64}$/.test(quote)&&isAddress(member))return <main className="setup-page"><a href="/booking">Group bookings</a><ProtectedBookingPage deployment={deployment} quoteId={quote as Hex} member={member}/><Suspense fallback={<p role="status">Loading native wallet…</p>}><ProtectedNativeContribution deployment={deployment} quote={quote as Hex} member={member}/></Suspense></main>;

 if(deployment?.chainId===420420777&&!quote&&p.get('wallet')==='native')return <main className="setup-page"><a href="/booking">Group bookings</a><Suspense fallback={<p role="status">Loading native wallet…</p>}><ProtectedNativeCreate deployment={deployment}/></Suspense></main>;

 if(deployment&&config?.privyAvailable&&config.privyAppId)return <main className="setup-page">{deployment.chainId===420420777&&(!quote?<a href="/protected?wallet=native">Create with Polkadot.js</a>:/^0x[0-9a-fA-F]{64}$/.test(quote)&&isAddress(member)&&<a href={`/protected?wallet=native&quote=${quote}&member=${member}`}>Contribute with Polkadot.js</a>)}<Suspense fallback={<p role="status">Loading protected wallet…</p>}><ProtectedWalletWorkspace appId={config.privyAppId} deployment={deployment}/></Suspense></main>;

 return <main className="setup-page"><a href="/booking">PactPay bookings</a><h1>Protected booking</h1>{!deployment?<p role="status">{message}</p>:!/^0x[0-9a-fA-F]{64}$/.test(quote)||!isAddress(member)?<p role="alert">Open the complete booking link to view its verified position.</p>:<ProtectedBookingPage deployment={deployment} quoteId={quote as Hex} member={member as Address}/>}</main>;

}
