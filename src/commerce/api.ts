export class ApiError extends Error {constructor(message:string,public status:number){super(message);}}
const bookingErrors:Record<string,string>={relay_unavailable:'Automatic sponsorship is not available yet.',relay_budget_unavailable:'The merchant has not enabled a fee budget.',relay_budget_paused:'The merchant paused fee sponsorship. You can release this unused quote.',relay_circuit_paused:'Sponsorship is temporarily paused by the operator.',relay_global_daily_cap:'The daily sponsorship limit has been reached.',sponsor_budget_exhausted:'The merchant fee budget is exhausted.',sponsor_daily_cap:'The daily sponsorship limit for this booking or account has been reached.',relay_native_funds_insufficient:'The fee payer needs more test tokens. No payment was sent.',relay_plan_changed:'This booking changed. Release the unused quote and review the new terms.',relay_quote_expired:'This payment quote expired. Start a fresh review.',relay_account_busy:'A previous action on this account needs to finish first.',relay_signer_busy:'The fee payer is processing another payment. Check this request before starting another.',relay_reservation_already_closed:'This unused quote was closed. Start a fresh review.',relay_cost_exceeds_cap:'The estimated cost exceeds the merchant budget. Release this unused quote.',relay_actual_cost_outside_cap:'Fee accounting needs review. Check the existing transaction; do not pay again.'};
let csrf='';
export function setCsrf(value:string){csrf=value;}
export async function api<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(`/api${path}`,{method,credentials:'same-origin',signal,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{'X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const token=response.headers.get('X-CSRF-Token');if(token)csrf=token;
 let value:unknown;try{value=await response.json();}catch{throw new ApiError('The booking service is unavailable. Your form is still saved on this device.',response.status);}
 if(!response.ok){const error=value as {error?:string|{message?:string;code?:string};message?:string};const message=error.message||(typeof error.error==='string'?error.error:error.error?.message)||`Request failed (${response.status}).`;const code=typeof error.error==='object'?error.error?.code:undefined;throw new ApiError(bookingErrors[code??message]??message,response.status);}
 return value as T;
}
export async function uploadInvoice(file:File,recipient?:string):Promise<unknown>{
 const response=await fetch('/api/invoice/extract',{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'X-CSRF-Token':csrf,...(recipient?{'X-OCR-Consent-Recipient':recipient}:{})},body:file});
 const value=await response.json();if(!response.ok)throw new ApiError(value.error?.message??'Invoice extraction failed. Enter the total manually.',response.status);return value;
}
