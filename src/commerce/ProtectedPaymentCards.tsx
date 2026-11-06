import {useEffect,useState} from 'react';
import {api} from './api';
import {formatAmount} from './model';
import type {Room} from './types';
type State={blockNumber:string;booking:{state:number;funded:string;total:string};merchantCredit:string;positions:{account:string;position:[string,string,string,boolean,boolean];credit:string}[];events:{event_name:string;tx_hash:string;block_number:string;event_args:Record<string,string>}[]};
export function ProtectedPaymentCards({rooms,userId,view,onOpen}:{rooms:Room[];userId:string;view:string;onOpen:(room:Room)=>void}){
 const [values,setValues]=useState<Record<string,State|null>>({});
 const identity=rooms.map(r=>r.id+':'+r.protectedBooking?.quoteId).join('|');
 useEffect(()=>{let active=true;setValues({});void Promise.all(rooms.map(async room=>{try{const value=await api<State>('/rooms/'+room.id+'/protected-booking');if(active)setValues(prev=>({...prev,[room.id]:value}));}catch{if(active)setValues(prev=>({...prev,[room.id]:null}));}}));return()=>{active=false;};},[identity,view]);
 return <>{rooms.map(room=>{const state=values[room.id],merchant=room.merchantId===userId,account=merchant?room.merchantAccountAddress:room.members.find(m=>m.userId===userId)?.accountAddress;
 const position=state?.positions.find(p=>p.account.toLowerCase()===account?.toLowerCase());
 const credit=state?(merchant?state.merchantCredit:position?.credit):undefined;
 const claims=state?.events.filter(e=>e.event_name==='Claimed'&&e.event_args.recipient?.toLowerCase()===account?.toLowerCase())??[];
 return <div className="pd-action-row" key={room.id}><div><strong>{room.title}</strong><small>{state?Number(state.booking.state)===3?'Cancelled · Protected V2':Number(state.booking.state)===2?'Captured · Protected V2':'Collection open · Protected V2':values[room.id]===null?'Payment verification unavailable':'Checking finalized payments…'}</small>
 {state&&<small>{view==='credits'?credit===undefined?'Your credit is unavailable':formatAmount(credit)+' demo dUSD available across this contract':formatAmount(state.booking.funded)+' / '+formatAmount(state.booking.total)+' demo dUSD contributed'} · finalized block {state.blockNumber}</small>}
 {view==='receipts'&&claims.map(e=><p key={e.tx_hash} className="pp-muted">Verified receipt · {formatAmount(e.event_args.amount)} dUSD transferred to your wallet · block {e.block_number}<br/>{e.tx_hash}</p>)}
 </div><button className="pp-secondary" onClick={()=>onOpen(room)}>{view==='receipts'?'View payment evidence':'Open protected checkout'}</button></div>;})}</>;
}
