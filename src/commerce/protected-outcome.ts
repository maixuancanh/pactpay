export type ProtectedReceiptEvent={event_name:string;block_number:string;log_index?:number;tx_hash:string;event_args:Record<string,string>};
export function protectedOutcome(member:string,merchant:string,paid:string,settled:boolean,state:number,credit:string,events:ProtectedReceiptEvent[]){
 if(BigInt(paid)===0n)return 'Awaiting contribution';
 if(!settled)return state===2?'Held during the complaint policy':'Contribution held in escrow';
 const settlement=events.find(e=>e.event_name==='Settled'&&e.event_args.member?.toLowerCase()===member.toLowerCase());
 if(!settlement)return 'Settled - transfer receipt awaiting verification';
 if(BigInt(settlement.event_args.refund??'0')>0n&&BigInt(settlement.event_args.payout??'0')>0n)return 'Agreed split settled - see refund and payout in the payment record';
 const refund=BigInt(settlement.event_args.refund??'0')>0n;
 const recipient=refund?member:merchant;
 const amount=BigInt(refund?settlement.event_args.refund:settlement.event_args.payout);
 const received=events.some(e=>e.event_name==='Claimed'&&e.event_args.recipient?.toLowerCase()===recipient.toLowerCase()&&BigInt(e.event_args.amount??'0')>=amount&&(BigInt(e.block_number)>BigInt(settlement.block_number)||(e.block_number===settlement.block_number&&(e.log_index??0)>(settlement.log_index??0))));
 if(received)return refund?'Refund received':'Merchant payment received';
 if(BigInt(credit)>0n)return refund?'Refund available to receive':'Merchant credit available';
 return 'Settled - transfer receipt awaiting verification';
}
