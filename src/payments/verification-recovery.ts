/** Reuse the original nonce so a lost approval cannot become a second transaction. */
export function verificationNonce(latest:number,pending:number,saved:string|null,reopen:boolean){
 if(!Number.isSafeInteger(latest)||latest<0||pending!==latest)throw Error('A transaction is pending. Check wallet activity before continuing.');
 if(!reopen)return latest;
 if(saved===null&&latest===0)return 0; // Original release only: brand-new account, no transaction sent.
 if(saved===null||!/^(0|[1-9][0-9]*)$/.test(saved)||Number(saved)!==latest)throw Error('The previous request may have been sent. Recover its transaction hash instead of signing again.');
 return latest;
}
