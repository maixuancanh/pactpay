import {it,expect} from 'vitest';
import {exactShare,previewRevision,deadlineText} from './agreement-preview';
it('rejects rounded or malformed shares and retains exact units',()=>{expect(exactShare('0.000001')).toBe(1n);for(const s of ['1.0000001','0','-1','1e2',''])expect(()=>exactShare(s)).toThrow();});
it('binds review to form contents and renders explicit time zones',()=>{expect(previewRevision({title:'a',members:['1']})).not.toBe(previewRevision({title:'a',members:['2']}));expect(deadlineText(1793693376n)).toMatch(/UTC/);expect(deadlineText(1793693376n)).toMatch(/Asia\/Saigon/);});
