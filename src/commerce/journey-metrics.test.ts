import {it,expect} from 'vitest';
import {recordJourney,readJourney} from './journey-metrics';
it('keeps only opt-in aggregate known counters, never imported personal fields',()=>{
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 recordJourney(storage,'login_started',false);expect(data.size).toBe(0);
 recordJourney(storage,'login_started',true);expect(readJourney(storage).counts.login_started).toBe(1);
 data.set('pactpay:journey-counts:v1',JSON.stringify({counts:{login_started:2,email:'secret',wallet_ready:-1},email:'private'}));
 expect(readJourney(storage)).toEqual({version:1,counts:{login_started:2}});
});
