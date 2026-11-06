export function stepCost(fee:bigint,deposit:bigint,spendable:bigint){if(fee<0n||deposit<0n)throw Error('Invalid cost estimate');return {required:fee+deposit,affordable:spendable>=fee+deposit};}
