import {useState} from 'react';
import {ArrowLeft,Bell,Copy,ChevronRight} from 'lucide-react';
import {useAccount} from './AccountProvider';
import {AccountTools} from './AccountTools';
import type {Room} from '../commerce/types';

export function ProfilePage({rooms,stale,onBookings,onNotifications}:{rooms:Room[];stale:boolean;onBookings:()=>void;onNotifications:()=>void}){
 const {session,logout}=useAccount();const [message,setMessage]=useState('');
 const address=session?.binding?.accountAddress;
 return <div className="pd-profile pd-profile-personal">
  <div className="pd-page-heading"><div><h1>Your profile</h1></div><button className="pp-text" onClick={onBookings}><ArrowLeft size={16}/>Back to bookings</button></div>
  <section className="pd-profile-identity"><div className="pd-profile-art"><img src="/art/pactpay/profile-companion.webp" alt="" width="132" height="150"/></div><div className="pd-profile-intro"><h2>{session?.user?.displayName||'Your account'}</h2><div className="pd-profile-address pd-profile-address-inline"><span>{address}</span>{address&&<button type="button" aria-label="Copy wallet address" title="Copy address" onClick={async()=>{try{await navigator.clipboard.writeText(address);setMessage('Address copied.');}catch{setMessage('Could not copy. Please select the address.');}}}><Copy size={16}/></button>}</div><div className="pd-profile-actions"><button className="pp-secondary" onClick={onNotifications}><Bell size={16}/>Manage notifications</button><button className="pp-text" onClick={()=>void logout().catch(e=>setMessage(e.message))}>Sign out</button></div>{message&&<p role="status">{message}</p>}</div></section>
  <button className="pd-profile-bookings" onClick={onBookings}><span><strong>My bookings</strong><small>View your groups, payments and refunds.</small></span><span>{stale?'':rooms.length}<ChevronRight size={18}/></span></button>
  <div className="pd-profile-settings"><AccountTools presentation="page"/></div>

 </div>;
}
