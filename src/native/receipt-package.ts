import {createShareLink,parseTransferBundle,type NativeTransferBundle} from './portability';
export function receiptBundle(raw:string):NativeTransferBundle {
 const bundle=parseTransferBundle(raw);
 if(bundle.kind!=='agreement'||bundle.agreements.length!==1)throw Error('Choose a single agreement file, not a workspace backup.');
 return bundle;
}
export function receiptLink(base:string,bundle:NativeTransferBundle){
 const url=new URL(createShareLink(base,receiptBundle(JSON.stringify(bundle))));
 url.pathname='/receipt';return url.href;
}
