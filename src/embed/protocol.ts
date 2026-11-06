export type CheckoutStatus='pending'|'confirmed'|'failed';
export type CheckoutMessage={type:'pactpay.checkout';version:1;nonce:string;sessionId:string;status:CheckoutStatus};
export function checkoutMessage(nonce:string,status:CheckoutStatus,sessionId:string):CheckoutMessage{return {type:'pactpay.checkout',version:1,nonce,sessionId,status};}
export function validateEmbedMessage(event:{origin:string;source:unknown;data:unknown},binding:{origin:string;source:unknown;nonce:string;sessionId:string}):event is typeof event & {data:CheckoutMessage}{
 if(binding.origin==='*'||event.origin!==binding.origin||event.source!==binding.source||!event.data||typeof event.data!=='object')return false;
 const data=event.data as Record<string,unknown>;
 return Object.keys(data).sort().join(',')==='nonce,sessionId,status,type,version'&&data.type==='pactpay.checkout'&&data.version===1&&data.nonce===binding.nonce&&data.sessionId===binding.sessionId&&['pending','confirmed','failed'].includes(String(data.status));
}
export function notifyHost(binding:{origin:string;nonce:string;sessionId:string},status:CheckoutStatus){if(window.parent===window||new URL(binding.origin).origin!==binding.origin||binding.origin==='*')return;window.parent.postMessage(checkoutMessage(binding.nonce,status,binding.sessionId),binding.origin);}
