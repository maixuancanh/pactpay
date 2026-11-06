export function supportsDenomination(chainId:number,rpcDecimals:number,nativeDecimals:number):boolean {
 return Number.isInteger(rpcDecimals)&&Number.isInteger(nativeDecimals)&&rpcDecimals>=0&&rpcDecimals<=36&&nativeDecimals>=0&&nativeDecimals<=36&&
  (rpcDecimals===nativeDecimals||(chainId===420420777&&rpcDecimals===18&&nativeDecimals===14));
}
/** Upper bounds round up so a fractional native base unit cannot lower the budget. */
export function rpcCostToNative(value:bigint,rpcDecimals:number,nativeDecimals:number):bigint {
 if(value<0n)throw Error('Invalid negative cost');
 if(rpcDecimals<=nativeDecimals)return value*10n**BigInt(nativeDecimals-rpcDecimals);
 const factor=10n**BigInt(rpcDecimals-nativeDecimals);
 return (value+factor-1n)/factor;
}
export function nativeCostToRpc(value:bigint,rpcDecimals:number,nativeDecimals:number):bigint {
 if(value<0n)throw Error('Invalid negative cost');
 if(rpcDecimals>=nativeDecimals)return value*10n**BigInt(rpcDecimals-nativeDecimals);
 const factor=10n**BigInt(nativeDecimals-rpcDecimals);
 return (value+factor-1n)/factor;
}
