import {GoogleEmbeddedWalletSignIn} from '../payments/GoogleEmbeddedWallet';
import {api} from '../commerce/api';
import {useAccount} from './AccountProvider';
export default function PrivyLogin({appId:_appId,background=false}:{appId:string;background?:boolean}){const {refresh,setConnection}=useAccount();return <><GoogleEmbeddedWalletSignIn background={background} onStatus={background?setConnection:undefined} onAuthenticated={async accessToken=>{await api('/auth/privy','POST',{accessToken});await refresh();}}/></>;}
