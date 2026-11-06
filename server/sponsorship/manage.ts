import type {Database,Row} from '../db/database.js';
import {amount,id,requireThat} from '../lib.js';
export class MerchantBudgets{
 constructor(private db:Database,private liveAvailable=false){}
 async list(userId:string){return(await this.db.query('SELECT id,cap,reserved,spent,enabled FROM sponsorship_budgets WHERE merchant_id=$1 ORDER BY id',[userId])).rows.map(this.view);}
 private view=(row:Row):Row=>{const remaining=BigInt(row.cap)-BigInt(row.reserved)-BigInt(row.spent);return {...row,remaining:remaining.toString(),liveAvailable:this.liveAvailable};}
 async save(userId:string,budgetId:string|null,input:Row){const cap=amount(input.cap);requireThat(!input.enabled||BigInt(cap)>0n,'enabled_budget_requires_positive_cap');requireThat(!input.enabled||this.liveAvailable,'sponsor_transport_unavailable',undefined,503);requireThat(typeof input.enabled==='boolean','budget_enabled_boolean_required');return this.db.transaction(async tx=>{
  if(!budgetId){const row=(await tx.query('INSERT INTO sponsorship_budgets(id,merchant_id,cap,enabled) VALUES($1,$2,$3,$4) RETURNING *',[id(),userId,cap,input.enabled])).rows[0];return this.view(row);}
  const old=(await tx.query('SELECT * FROM sponsorship_budgets WHERE id=$1 AND merchant_id=$2 FOR UPDATE',[budgetId,userId])).rows[0];requireThat(old,'budget_not_found',undefined,404);
  requireThat(BigInt(cap)>=BigInt(old.reserved)+BigInt(old.spent),'cap_below_committed_budget','Cap cannot be lower than reserved and spent amounts',409);
  const row=(await tx.query('UPDATE sponsorship_budgets SET cap=$3,enabled=$4 WHERE id=$1 AND merchant_id=$2 RETURNING *',[budgetId,userId,cap,input.enabled])).rows[0];return this.view(row);
 });}
}
