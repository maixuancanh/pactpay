import {createContext,useCallback,useContext,useEffect,useState,useRef,type ReactNode} from 'react';
import {api,setCsrf} from '../commerce/api';
import type {CommerceConfig} from '../commerce/types';
export type WalletBinding={walletId:string;ownerAddress:string;accountAddress:string;chainId:number;mode:'embedded-eoa'|'smart-account'|'native';verified?:boolean};
export type AccountSession={user:{id:string;displayName?:string}|null;binding:WalletBinding|null;atomicAccount?:import('./AtomicAccountSettings').AtomicRegistration|null;csrfToken?:string};
export type ConnectionStatus={busy:boolean;error:string};
type AccountContextValue={connection:ConnectionStatus;setConnection:(status:ConnectionStatus)=>void;session:AccountSession|null;config:CommerceConfig|null;loading:boolean;error:string;refresh:()=>Promise<void>;logout:()=>Promise<void>};
const AccountContext=createContext<AccountContextValue|null>(null);
export function AccountProvider({children}:{children:ReactNode}){const request=useRef(0);const [connection,setConnection]=useState<ConnectionStatus>({busy:false,error:''});const [session,setSession]=useState<AccountSession|null>(null);const [config,setConfig]=useState<CommerceConfig|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const refresh=useCallback(async()=>{const generation=++request.current;try{const [next,configuration]=await Promise.all([api<AccountSession>('/session'),api<CommerceConfig>('/config')]);if(generation!==request.current)return;if(next.csrfToken)setCsrf(next.csrfToken);setSession(next);setConfig(configuration);setError('');}catch(e){if(generation===request.current)setError((e as Error).message);}finally{if(generation===request.current)setLoading(false);}},[]);
 useEffect(()=>{void refresh();const handler=()=>void refresh();window.addEventListener('focus',handler);return()=>window.removeEventListener('focus',handler);},[refresh]);
 const logout=async()=>{++request.current;sessionStorage.setItem('pactpay:explicit-signout','1');window.dispatchEvent(new Event('pactpay:logout'));await api('/auth/logout','POST',{});setSession(null);await refresh();};
 return <AccountContext.Provider value={{session,config,loading,error,refresh,logout,connection,setConnection}}>{children}</AccountContext.Provider>;
}
export function useAccount(){const value=useContext(AccountContext);if(!value)throw new Error('AccountProvider is required.');return value;}
