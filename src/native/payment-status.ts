export type ClaimKind='unknown'|'merchant-payout'|'contributor-refund';
export type PaymentViewStatus='unknown'|'collecting'|'ready'|'payout-available'|'payout-verified'|'refund-available'|'refund-verified'|'closed-unverified';
export function paymentStatus(state:number,credit:bigint,proof:ClaimKind,merchant:boolean,fresh:boolean):PaymentViewStatus{
 if(!fresh)return 'unknown';
 if(state===3&&proof==='merchant-payout')return 'payout-verified';
 if((state===4||state===5)&&proof==='contributor-refund')return 'refund-verified';
 if(credit>0n)return state===3&&merchant?'payout-available':state>=4?'refund-available':'unknown';
 return state===1?'collecting':state===2?'ready':state>=3?'closed-unverified':'unknown';
}
export const paymentLabels:Record<PaymentViewStatus,string>={unknown:'Refresh to verify',collecting:'Collecting fixed shares',ready:'Funded; awaiting capture','payout-available':'Merchant payout available','payout-verified':'Merchant payout verified','refund-available':'Refund available','refund-verified':'Refund transfer verified','closed-unverified':'Closed; inspect transfer evidence'};
