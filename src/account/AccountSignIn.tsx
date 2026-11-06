import {Suspense,lazy} from 'react';
import {useAccount} from './AccountProvider';
import {GoogleSignIn} from './GoogleSignIn';
const PrivyLogin=lazy(()=>import('./PrivyLogin'));
export function AccountSignIn(){const {config}=useAccount();return config?.privyAppId&&config.privyAvailable?<Suspense fallback={<p role="status">Loading your secure wallet provider…</p>}><PrivyLogin appId={config.privyAppId}/></Suspense>:<GoogleSignIn/>;}
