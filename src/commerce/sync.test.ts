import {it,expect} from 'vitest';
import {syncEvidence} from './sync';
import type {IndexedEvidence} from './evidence';
it('drains bounded pages before returning payment evidence',async()=>{const paths:string[]=[];const a={kind:'Contributed'} as IndexedEvidence,b={kind:'Withdrawn'} as IndexedEvidence;const result=await syncEvidence(async path=>{paths.push(path);return paths.length===1?{events:[a],nextCursor:'next:page'}:{events:[b],nextCursor:null};});expect(result).toEqual([a,b]);expect(paths).toEqual(['/sync','/sync?after=next%3Apage']);});
it('fails closed when a cursor repeats',async()=>{await expect(syncEvidence(async()=>({events:[],nextCursor:'same'}))).rejects.toThrow('stalled');});
