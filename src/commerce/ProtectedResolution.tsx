import {useState} from 'react';
import {formatUnits,parseUnits,type Address,type Hex} from 'viem';

export type ResolutionTerms={refund:bigint;deadline:bigint};
export type SignedResolution=ResolutionTerms&{buyerSignature:Hex;merchantSignature:Hex};
export function ProtectedResolution({paid,deadline,chainTime,member,isMerchant,canSign,busy,onSign,onReview}:{
 paid:bigint;deadline:bigint;chainTime:bigint;member:Address;isMerchant:boolean;canSign:boolean;busy:boolean;
 onSign:(terms:ResolutionTerms)=>Promise<Hex>;onReview:(resolution:SignedResolution)=>void;
}){
 const [amount,setAmount]=useState('');
 const expiry=deadline-1n;
 const [buyer,setBuyer]=useState('');
 const [merchant,setMerchant]=useState('');
 const [error,setError]=useState('');
 const [signing,setSigning]=useState(false);
 const refund=/^\d+(\.\d{1,6})?$/.test(amount)?parseUnits(amount,6):null;
 function terms():ResolutionTerms{
  if(refund===null||refund>paid)throw Error('Enter a refund between zero and the paid share, with up to six decimal places.');
  if(expiry<=chainTime||expiry>=deadline)throw Error('Signature expiry must be after the current block and before the resolution deadline.');
  return {refund,deadline:expiry};
 }
 function resetSignatures(){setBuyer('');setMerchant('');setError('');}
 return <fieldset className="pp-form" disabled={busy||signing}>
  <legend>Resolve this complaint together</legend>
  <p>Both wallets must sign the same refund amount and expiry. The buyer receives the refund and the merchant receives the rest after settlement.</p>
  <p className="pp-muted" style={{overflowWrap:'anywhere'}}>Buyer {member}</p>
  <label>Buyer refund in demo dUSD<input inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);resetSignatures();}}/></label>
  {refund!==null&&refund<=paid&&<p>Merchant share <strong>{formatUnits(paid-refund,6)} dUSD</strong></p>}
  <p className="pp-muted">Signatures expire {new Date(Number(expiry)*1000).toLocaleString('en-GB')} (local time).</p>
  {canSign?<button type="button" className="pp-secondary" onClick={async()=>{
   setSigning(true);setError('');
   try{const signature=await onSign(terms());setError('');if(isMerchant)setMerchant(signature);else setBuyer(signature);}
   catch(e){setError((e as Error).message);}finally{setSigning(false);}
  }}>Sign this split with my wallet</button>:<p className="pp-muted">This contract accepts Ethereum typed signatures from the fixed booking accounts. Polkadot.js native ownership signatures cannot authorize a mutual split. The deadline-based refund policy remains available.</p>}
  <label>Buyer signature<textarea rows={2} spellCheck={false} value={buyer} onChange={e=>setBuyer(e.target.value.trim())}/></label>
  <label>Merchant signature<textarea rows={2} spellCheck={false} value={merchant} onChange={e=>setMerchant(e.target.value.trim())}/></label>
  <button type="button" className="pp-primary" onClick={()=>{
   try{setError('');if(![buyer,merchant].every(value=>/^0x(?:[a-f\d]{2})+$/i.test(value)&&value.length<=8194))throw Error('Enter both wallet signatures.');onReview({...terms(),buyerSignature:buyer as Hex,merchantSignature:merchant as Hex});}
   catch(e){setError((e as Error).message);}
  }}>Review mutual settlement</button>
  {error&&<p role="status">{error}</p>}
 </fieldset>;
}
