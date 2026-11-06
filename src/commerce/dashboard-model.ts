import type {Room} from './types';
export type CreditView={finality:string;blockHash:string;blockNumber:string;state:number;credits:{accountAddress:string;credit:string;contribution:string;share:string;claimReceived:string|null}[]};
export function ownCredit(room:Room,userId:string,snapshot:CreditView):{amount:string;kind:'payout'|'refund'|'credit'}|null{
  if(snapshot.finality!=='finalized'||!/^0x[0-9a-fA-F]{64}$/.test(snapshot.blockHash)||!/^\d+$/.test(snapshot.blockNumber))throw Error('Finalized credit evidence unavailable');
  const merchant=room.merchantId===userId;
  const memberAddress=room.members.find(m=>m.userId===userId)?.accountAddress;
  const address=snapshot.state===4||snapshot.state===5?memberAddress:merchant?room.merchantAccountAddress:memberAddress;
  if(!address)return null;
  const c=snapshot.credits.find(c=>c.accountAddress.toLowerCase()===address.toLowerCase());
  if(!c||!/^\d+$/.test(c.credit))throw Error('Your credit amount is unavailable');
  return {amount:c.credit,kind:snapshot.state===3&&merchant?'payout':snapshot.state===4||snapshot.state===5?'refund':'credit'};
}
export function paymentCandidate(room:Room,userId:string,now=Date.now()){
  const member=room.members.find(m=>m.userId===userId);
  return !!(room.quote&&member&&member.acceptedRevision===room.revision&&!member.paymentFinalized&&['funding','published','collecting'].includes(room.status)&&Date.parse(room.fundingDeadline)>now);
}
export function receiptHref(room:Room){const q=room.quote;return q?`/receipt?chainId=${q.chainId}&escrow=${encodeURIComponent(q.escrow)}&quoteId=${encodeURIComponent(q.quoteId)}`:null;}
export function contributionDue(room:Room,userId:string,snapshot:CreditView){
  if(snapshot.finality!=='finalized'||!/^0x[0-9a-fA-F]{64}$/.test(snapshot.blockHash)||snapshot.state!==1)return false;
  const member=room.members.find(m=>m.userId===userId),row=snapshot.credits.find(c=>c.accountAddress.toLowerCase()===member?.accountAddress.toLowerCase());
  return !!(member&&row&&/^\d+$/.test(row.contribution)&&row.share===member.share&&BigInt(row.contribution)<BigInt(member.share));
}
