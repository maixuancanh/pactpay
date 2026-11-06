import {parseUnits} from 'viem';
export function exactShare(value:string){if(!/^\d+(?:\.\d{1,6})?$/.test(value))throw Error('Enter a positive amount with at most six decimal places.');const n=parseUnits(value,6);if(n<=0n)throw Error('Every share must be positive.');return n;}
export const previewRevision=(value:unknown)=>JSON.stringify(value);
export function deadlineText(seconds:bigint){const date=new Date(Number(seconds)*1000);return `${date.toISOString()} UTC / ${date.toLocaleString('en-GB',{timeZone:'Asia/Saigon'})} Asia/Saigon`;}
