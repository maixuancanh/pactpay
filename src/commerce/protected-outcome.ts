export type ProtectedReceiptEvent={event_name:string;block_number:string;log_index?:number;tx_hash:string;event_args:Record<string,string>};
export function protectedOutcome(member:string,paid:string,settled:boolean,state:number,events:ProtectedReceiptEvent[]){
 if(BigInt(paid)===0n)return 'Awaiting contribution';
 if(!settled)return state===2?'Held during the complaint policy':'Contribution held in escrow';
 const settlement=events.find(e=>e.event_name==='Settled'&&e.event_args.member?.toLowerCase()===member.toLowerCase());
 if(!settlement)return 'Settled - transfer receipt awaiting verification';
 if(BigInt(settlement.event_args.refund??'0')>0n&&BigInt(settlement.event_args.payout??'0')>0n)return 'Agreed split settled - see refund and payout in the payment record';
 const refund=BigInt(settlement.event_args.refund??'0')>0n;
 return refund?'Allocated to refund credit':'Allocated to merchant credit';
}
