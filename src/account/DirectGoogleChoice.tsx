import {useState} from 'react';
import {usePrivy,useLoginWithOAuth} from '@privy-io/react-auth';
import {ArrowUpRight} from 'lucide-react';
export default function DirectGoogleChoice({onRestore}:{onRestore:()=>void}){
 const {ready,authenticated}=usePrivy();const {initOAuth,loading}=useLoginWithOAuth();const [error,setError]=useState('');
 return <><button disabled={!ready||loading} onClick={()=>{sessionStorage.removeItem('pactpay:explicit-signout');if(authenticated){onRestore();return;}setError('');void initOAuth({provider:'google'}).catch(()=>setError('Google sign-in could not open. Please try again.'));}}><span className="pp-connect-symbol pp-google-symbol">G</span><span><strong>{loading?'Opening Google…':'Google'}</strong><small>Sign in with your Google account</small></span><ArrowUpRight size={18}/></button>{error&&<p role="alert">{error}</p>}</>;
}
