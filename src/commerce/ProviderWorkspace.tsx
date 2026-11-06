import {ProtectedWalletBridge} from '../payments/ProtectedWalletBridge';
import {RestoreGoogleSession} from '../account/RestoreGoogleSession';
import {GoogleEmbeddedWalletProvider} from '../payments/GoogleEmbeddedWallet';
import {PrivyCommerceBridge} from '../payments/PrivyCommerceBridge';
import type {CommerceFlowFactory} from './ConfiguredFlow';
import type {ReactNode} from 'react';
export default function ProviderWorkspace({appId,children}:{appId:string;children:(factory?:CommerceFlowFactory)=>ReactNode}){return <GoogleEmbeddedWalletProvider appId={appId}><RestoreGoogleSession/><ProtectedWalletBridge><PrivyCommerceBridge>{children}</PrivyCommerceBridge></ProtectedWalletBridge></GoogleEmbeddedWalletProvider>;}
