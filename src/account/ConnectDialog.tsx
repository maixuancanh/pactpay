import {NativeSignIn} from './NativeSignIn';
import {useEffect,useState,lazy,Suspense} from 'react';

import * as Dialog from '@radix-ui/react-dialog';

import {ArrowLeft,ArrowUpRight,Wallet,X} from 'lucide-react';

import {AccountSignIn} from './AccountSignIn';

import {useAccount} from './AccountProvider';

const DirectGoogleChoice=lazy(()=>import('./DirectGoogleChoice'));

export function ConnectDialog({open,onClose}:{open:boolean;onClose:()=>void}){

 const {config}=useAccount();

 const [view,setView]=useState<'choose'|'google'|'wallet'>('choose');

 useEffect(()=>{if(!open)setView('choose');},[open]);

 return <Dialog.Root open={open} onOpenChange={value=>{if(!value)onClose();}}><Dialog.Portal><Dialog.Overlay className="pp-overlay"/><Dialog.Content className="pp-connect-dialog"><Dialog.Close className="pp-icon pp-connect-close" aria-label="Close connection options"><X size={18}/></Dialog.Close>{view!=='choose'&&<button className="pp-text" onClick={()=>setView('choose')}><ArrowLeft size={15}/> Back</button>}<div className="pp-connect-mark"><Wallet size={24}/></div><Dialog.Title>Connect to PactPay</Dialog.Title><Dialog.Description>{view==='choose'?'Choose how you would like to connect':view==='google'?'Create or restore your wallet with Google':'Use the wallet that holds your funds and orders'}</Dialog.Description>{view==='choose'?<div className="pp-connect-options"><button onClick={()=>setView('wallet')}><span className="pp-connect-symbol"><Wallet size={23}/></span><span><strong>Connect wallet</strong><small>Connect your existing Web3 wallet</small></span><ArrowUpRight size={18}/></button>{config?.privyAvailable?<Suspense fallback={<button disabled>Loading Google…</button>}><DirectGoogleChoice onRestore={()=>setView('google')}/></Suspense>:<button onClick={()=>setView('google')}><span className="pp-connect-symbol pp-google-symbol">G</span><span><strong>Google</strong><small>Sign in with your Google account</small></span><ArrowUpRight size={18}/></button>}</div>:view==='google'?<AccountSignIn/>:<div className="pp-connect-options"><NativeSignIn/><a href="/evm"><span className="pp-connect-symbol"><Wallet size={23}/></span><span><strong>Ethereum / EVM wallet</strong><small>MetaMask, OKX or another browser wallet</small></span><ArrowUpRight size={18}/></a><p className="pp-muted">Choose the wallet used for your order. Google and existing wallets keep their own funds and payment rights.</p></div>}<p className="pp-connect-note">Connecting does not approve a payment.</p></Dialog.Content></Dialog.Portal></Dialog.Root>;

}
