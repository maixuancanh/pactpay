import {createContext,useContext,type ReactNode} from 'react';
import {useWallets} from '@privy-io/react-auth';
import type {EIP1193Provider} from 'viem';
import {useAccount} from '../account/AccountProvider';

type Provider=Pick<EIP1193Provider,'request'>;
const WalletContext=createContext<Provider|null>(null);
export function ProtectedWalletBridge({children}:{children:ReactNode}){
 const {session}=useAccount();
 const {wallets}=useWallets();
 const matching=wallets.filter(wallet=>wallet.walletClientType==='privy'&&wallet.type==='ethereum'&&wallet.address.toLowerCase()===session?.binding?.accountAddress.toLowerCase());
 const provider:Provider|null=matching.length===1?{request:async args=>(await matching[0].getEthereumProvider()).request({method:args.method,params:Array.isArray(args.params)?args.params:undefined})}:null;
 return <WalletContext.Provider value={provider}>{children}</WalletContext.Provider>;
}
export function useProtectedWallet(){return useContext(WalletContext);}
