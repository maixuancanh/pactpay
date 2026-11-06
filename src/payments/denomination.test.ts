import {it,expect} from 'vitest';
import {rpcCostToNative,nativeCostToRpc,supportsDenomination} from './denomination';
it('rounds V3 native cost bounds up and preserves EVM transaction units',()=>{
 expect(rpcCostToNative(12307240339520300n,18,14)).toBe(1230724033953n);
 expect(rpcCostToNative(1n,18,14)).toBe(1n);
 expect(nativeCostToRpc(1230724033953n,18,14)).toBe(12307240339530000n);
 expect(rpcCostToNative(23n,18,18)).toBe(23n);
 expect(supportsDenomination(420420777,18,14)).toBe(true);
 expect(supportsDenomination(31337,18,14)).toBe(false);
 expect(supportsDenomination(420420777,18,12)).toBe(false);
});
