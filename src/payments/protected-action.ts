import type {ProtectedAction} from './protected-flow-port';
export type ProtectedActionSnapshot={booking:{merchant:string;capturedAt:bigint;window:bigint;resolutionPeriod:bigint;fundingDeadline:bigint;captureDeadline:bigint;funded:bigint;total:bigint;state:number};position:readonly [bigint,bigint,bigint,boolean,boolean];timestamp:bigint;actorCredit:bigint;actor:string;member:string};
export function protectedNextAction(x:ProtectedActionSnapshot):ProtectedAction|null{
 const b=x.booking,p=x.position,now=x.timestamp,self=x.actor.toLowerCase()===x.member.toLowerCase(),merchant=x.actor.toLowerCase()===b.merchant.toLowerCase();
 if(x.actorCredit>0n)return 'claim';
 if(!p[4]&&p[1]>0n){if(b.state===3||(b.state===1&&(now>=b.captureDeadline||(b.funded<b.total&&now>=b.fundingDeadline))))return 'settle';if(b.state===2){const complaint=b.capturedAt+b.window,resolution=complaint+b.resolutionPeriod;if(self&&!p[3]&&now<complaint)return 'dispute';if((!p[3]&&now>=complaint)||(p[3]&&now>=resolution))return 'settle';}}
 if(self&&p[0]>0n&&p[1]===0n&&b.state===1&&now<b.fundingDeadline)return 'contribute';
 if(merchant&&b.state===1&&b.funded===b.total&&now<b.captureDeadline)return 'capture';return null;
}
