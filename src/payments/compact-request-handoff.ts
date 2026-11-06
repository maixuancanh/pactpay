export const REQUEST_KEY='pactpay:compact-signed-request';
export const REQUEST_CHANNEL='pactpay:compact-handoff:v1';
export function validCompactRequest(raw:string,now=Date.now()):boolean{
 try{if(raw.length>100000)return false;const r=JSON.parse(raw);return r.version==='compact-v1'&&r.chainId===420420777&&/^0x[0-9a-f]{40}$/i.test(r.account)&&/^0x[0-9a-f]{40}$/i.test(r.owner)&&/^0x[0-9a-f]{130}$/i.test(r.signature)&&/^\d+$/.test(r.deadline)&&BigInt(r.deadline)>BigInt(Math.floor(now/1000))&&Array.isArray(r.calls)&&r.calls.length>=1&&r.calls.length<=2;}catch{return false;}
}
