import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertVerificationTransaction} from '../payments/eoa-verification.js';
test('execution activation accepts only the bounded self-verification transaction',()=>{
 const account='0x0000000000000000000000000000000000000001' as const;
 const tx={from:account,to:account,value:0n,input:'0x506163745061792056332077616c6c657420636865636b',chainId:420420777,gas:1000n,gasPrice:20000n};
 assert.doesNotThrow(()=>assertVerificationTransaction(account,420420777,tx));
 const dynamic={...tx,type:'eip1559',gasPrice:0n,maxFeePerGas:26184n,gas:679902405155n};
 assert.doesNotThrow(()=>assertVerificationTransaction(account,420420777,dynamic));
 for(const changed of [{maxFeePerGas:0n},{maxFeePerGas:undefined},{gas:20000000000000001n}])assert.throws(()=>assertVerificationTransaction(account,420420777,{...dynamic,...changed}));
 for(const changed of [
  {from:'0x0000000000000000000000000000000000000002'},
  {to:'0x0000000000000000000000000000000000000002'},
  {value:1n},{input:'0x'},{chainId:1},{gasPrice:0n},{gas:20000000000000001n},
 ])assert.throws(()=>assertVerificationTransaction(account,420420777,{...tx,...changed}));
});
