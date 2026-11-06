import {useEffect} from 'react';
import {usePrivy,useLoginWithOAuth} from '@privy-io/react-auth';
import {useAccount} from './AccountProvider';
import PrivyLogin from './PrivyLogin';
// Keep OAuth completion and wallet preparation mounted without a visible setup panel.
export function RestoreGoogleSession(){
 const {authenticated}=usePrivy();const {loading,state}=useLoginWithOAuth();const {session,setConnection}=useAccount();
 useEffect(()=>{if(session?.user)setConnection({busy:false,error:''});else if(loading)setConnection({busy:true,error:''});else if(state.status==='error')setConnection({busy:false,error:'Sign-in could not finish. Open Connect and try again.'});},[loading,state.status,session?.user?.id,setConnection]);
 return !session?.user&&authenticated&&sessionStorage.getItem('pactpay:explicit-signout')!=='1'?<PrivyLogin appId="" background/>:null;
}
