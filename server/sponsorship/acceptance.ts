import {decodeFunctionData,parseAbi,type Address} from 'viem';
import {requireThat} from '../lib.js';
import {relayPlannerAbi,type RelayAction} from './compact-planner.js';
import type {RelayCall} from './compact-codec.js';
const approval=parseAbi(['function approve(address,uint256) returns(bool)']);
/** An operator label is not proof that the claimed action was actually exercised. */
export function verifyAcceptanceAction(kind:RelayAction,calls:RelayCall[],deployment:{account:Address;escrow:Address;token:Address}){
 const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 const decoded=calls.map(c=>{requireThat(same(c.target,deployment.token)||same(c.target,deployment.escrow),'relay_acceptance_target_mismatch');return decodeFunctionData({abi:same(c.target,deployment.token)?approval:relayPlannerAbi,data:c.data});});
 const expected:Record<RelayAction,string[]>={publish:['createQuoteNativeWithTerms'],payment:['approve','contribute'],'merchant-payout':['capture','claim'],refund:['expire','claim'],cancel:['cancel']};
 requireThat(expected[kind]&&decoded.map(c=>c.functionName).join(',')===expected[kind].join(','),'relay_acceptance_action_mismatch');
 if(kind==='payment'){const args=decoded[0].args as readonly any[];requireThat(same(calls[0].target,deployment.token)&&same(args[0],deployment.escrow)&&args[1]>0n&&same(calls[1].target,deployment.escrow),'relay_acceptance_approval_mismatch');return {quoteId:(decoded[1].args as readonly any[])[0],termsHash:(decoded[1].args as readonly any[])[1],approved:args[1] as bigint};}
 requireThat(calls.every(c=>same(c.target,deployment.escrow)),'relay_acceptance_target_mismatch');
 if(kind==='publish'){const q=(decoded[0].args as readonly any[])[0];requireThat(same(q.merchant,deployment.account)&&same(q.token,deployment.token),'relay_acceptance_publish_owner_mismatch');}
 if(decoded.length===2)requireThat((decoded[0].args as readonly any[])[0]===(decoded[1].args as readonly any[])[0],'relay_acceptance_quote_mismatch');
 return null;
}
