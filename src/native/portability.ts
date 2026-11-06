import {isAddress,type Address,type Hex} from 'viem';
import {parseNativePackage,serializeNativePackage} from './packages';

export const MAX_TRANSFER_BYTES=1000000;
export const MAX_SHARE_LENGTH=16384;
export type NativeDeployment={chainId:420420777;contract:Address;token:Address;codeHash:Hex;tokenCodeHash:Hex;blockNumber:string};
export type NativeTransferBundle={schema:'pactpay-transfer-v1';kind:'agreement'|'workspace';deployment:NativeDeployment;agreements:string[]};
const bytes=(value:string)=>new TextEncoder().encode(value).length;
const strictKeys=(value:unknown,allowed:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw Error('Unsupported or unexpected fields in this file.');};
function deploymentOnly(value:any):NativeDeployment{
 if(!value||value.chainId!==420420777||!isAddress(value.contract)||!isAddress(value.token)||/^0x0{40}$/i.test(value.contract)||/^0x0{40}$/i.test(value.token)||!/^0x[0-9a-f]{64}$/i.test(value.codeHash)||!/^0x[0-9a-f]{64}$/i.test(value.tokenCodeHash)||typeof value.blockNumber!=='string'||!/^\d{1,20}$/.test(value.blockNumber))throw Error('Invalid V3 deployment identity.');
 return {chainId:420420777,contract:value.contract,token:value.token,codeHash:value.codeHash,tokenCodeHash:value.tokenCodeHash,blockNumber:value.blockNumber};
}
export function createTransferBundle(kind:'agreement'|'workspace',deployment:NativeDeployment,agreements:string[]):NativeTransferBundle{
 if(!['agreement','workspace'].includes(kind))throw Error('Unsupported transfer kind.');
 if(!Array.isArray(agreements)||agreements.length>50)throw Error('A backup supports up to 50 agreements.');
 if(kind==='agreement'&&agreements.length!==1)throw Error('Share exactly one agreement.');
 const config=deploymentOnly(deployment),ids=new Set<string>();
 const canonical=agreements.map(raw=>{if(typeof raw!=='string'||bytes(raw)>50000)throw Error('Agreement file is too large.');const p=parseNativePackage(raw,config);if(ids.has(p.id))throw Error('Duplicate agreements in the backup.');ids.add(p.id);return serializeNativePackage(p);});
 const bundle:NativeTransferBundle={schema:'pactpay-transfer-v1',kind,deployment:config,agreements:canonical};
 if(bytes(JSON.stringify(bundle))>MAX_TRANSFER_BYTES)throw Error('Workspace file is too large.');
 return bundle;
}
export function parseTransferBundle(raw:string):NativeTransferBundle{
 if(typeof raw!=='string'||bytes(raw)>MAX_TRANSFER_BYTES)throw Error('Workspace file is too large.');
 const value=JSON.parse(raw);strictKeys(value,['schema','kind','deployment','agreements']);
 if(value.schema!=='pactpay-transfer-v1')throw Error('Unsupported PactPay transfer file.');
 strictKeys(value.deployment,['chainId','contract','token','codeHash','tokenCodeHash','blockNumber']);
 return createTransferBundle(value.kind,value.deployment,value.agreements);
}
export function createShareLink(base:string,bundle:NativeTransferBundle):string{
 const parsed=parseTransferBundle(JSON.stringify(bundle));if(parsed.kind!=='agreement')throw Error('Use a file to share a workspace backup; links contain one agreement.');
 const url=new URL(base);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Use an HTTP or HTTPS workspace URL.');url.pathname='/native';url.search='';
 const payload=new TextEncoder().encode(JSON.stringify(parsed));let binary='';for(const byte of payload)binary+=String.fromCharCode(byte);
 url.hash='pactpay='+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 if(url.href.length>MAX_SHARE_LENGTH)throw Error('This agreement is too large for a link. Download and share the agreement file instead.');
 return url.href;
}
export function parseShareFragment(fragment:string):NativeTransferBundle|null{
 if(!fragment.startsWith('#pactpay='))return null;
 if(fragment.length>MAX_SHARE_LENGTH)throw Error('Share link is too large. Ask for the agreement file.');
 const encoded=fragment.slice(9);if(!encoded||!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error('Invalid PactPay share link.');
 const binary=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));const payload=Uint8Array.from(binary,char=>char.charCodeAt(0));
 const bundle=parseTransferBundle(new TextDecoder('utf-8',{fatal:true}).decode(payload));if(bundle.kind!=='agreement')throw Error('Share links may contain one agreement only.');return bundle;
}
