// Local, opt-in aggregate counters. Never accept arbitrary event properties.
export const journeyEvents = ['login_started','wallet_ready','room_joined','share_accepted','payment_submitted','payment_finalized','claim_finalized'] as const;
export type JourneyEvent = typeof journeyEvents[number];
type Metrics = {version:1; counts:Partial<Record<JourneyEvent,number>>};
const key='pactpay:journey-counts:v1';
export function recordJourney(storage:Pick<Storage,'getItem'|'setItem'>,event:JourneyEvent,optIn:boolean):void {
 if(!optIn||!journeyEvents.includes(event))return;
 const next=readJourney(storage);next.counts[event]=(next.counts[event]??0)+1;
 storage.setItem(key,JSON.stringify(next));
}
export function readJourney(storage:Pick<Storage,'getItem'>):Metrics {
 const result:Metrics={version:1,counts:{}};
 try {const raw=JSON.parse(storage.getItem(key)||'{}');for(const name of journeyEvents){const n=raw.counts?.[name];if(Number.isSafeInteger(n)&&n>=0)result.counts[name]=n;}}catch{}
 return result;
}
