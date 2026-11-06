import {useState} from 'react';
import {stringToHex} from '@polkadot/util';
import {connectNativeWallet} from '../native/adapter';
import {api,setCsrf} from '../commerce/api';
import {useAccount} from './AccountProvider';
export function NativeSignIn(){
 const {refresh}=useAccount();
 const [accounts,setAccounts]=useState<{address:string;name?:string}[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <section className="pp-form"><h3>Polkadot.js</h3><p>Connect the wallet that will organize bookings or pay your share.</p>{!accounts.length?<button className="pp-secondary" disabled={busy} onClick={()=>void run(async()=>{const value=await connectNativeWallet();setAccounts(value);setSelected(value[0]?.address??'');})}>Choose native account</button>:<><label>Native account<select value={selected} onChange={e=>setSelected(e.target.value)}>{accounts.map(a=><option key={a.address} value={a.address}>{a.name??'Account'} - {a.address}</option>)}</select></label><button className="pp-primary" disabled={busy||!selected} onClick={()=>void run(async()=>{
 const challenge=await api<{id:string;message:string;address:string}>('/auth/native/challenge','POST',{address:selected});
 const {web3FromAddress}=await import('@polkadot/extension-dapp');
 const injector=await web3FromAddress(selected);
 if(!injector.signer.signRaw)throw Error('This wallet cannot sign the login message.');
 const signed=await injector.signer.signRaw({address:selected,data:stringToHex(challenge.message),type:'bytes'});
 const result=await api<{csrfToken:string}>('/auth/native','POST',{challengeId:challenge.id,signature:signed.signature});
 setCsrf(result.csrfToken);sessionStorage.setItem('pactpay:explicit-signout','1');await refresh();
 })}>{busy?'Checking wallet...':'Sign in with this wallet'}</button><p className="pp-muted">Review one ownership message in your extension to sign in. Each payment has its own cost review.</p></>}{error&&<p role="alert">{error}</p>}</section>;
}
