export type CheckoutInput = {
  connected: boolean; mapped: boolean; fresh: boolean; pending: boolean;
  state: number; now: bigint; funding: bigint; capture: bigint;
  share: bigint; contributed: bigint; credit: bigint; balance: bigint;
  allowance: bigint; merchant: boolean;
};
export type CheckoutAction = {
  action: 'recover' | 'connect' | 'refresh' | 'approve' | 'contribute' | 'capture' | 'claim' | 'expire' | 'wait';
  label: string; reason: string; enabled: boolean;
};
export function checkoutAction(x: CheckoutInput): CheckoutAction {
  const result = (action: CheckoutAction['action'], label: string, reason: string, enabled = true) => ({action,label,reason,enabled});
  if (x.pending) return result('recover','Check pending transaction','Resolve the saved transaction before requesting another signature.');
  if (!x.connected) return result('connect','Connect member or merchant wallet','Use the wallet named in this agreement.');
  if (!x.mapped || !x.fresh) return result('refresh','Verify wallet and refresh agreement','Payment actions need a current chain read and verified wallet mapping.');
  if (x.credit > 0n) return result('claim','Review claim to your wallet','Claim transfers available credit; capture alone does not transfer tokens.');
  if ((x.state === 1 && x.now >= x.funding) || (x.state === 2 && x.now >= x.capture)) return result('expire','Review expiry and refunds','After expiry is processed, each contributor claims their own refund.');
  if (x.state === 2) return x.merchant ? result('capture','Review collection capture','Capture creates merchant credit. Claim it separately to receive tokens.') : result('wait','Waiting for merchant','All shares are funded. The merchant can capture before the deadline.',false);
  if (x.state !== 1) return result('wait','Review payment evidence','This collection is closed. Zero credit alone does not prove a payout or refund.',false);
  if (x.share === 0n) return result('connect','Choose a paying member wallet',x.merchant ? 'Share the agreement with members; this merchant wallet has no fixed share.' : 'This wallet is not a paying member.');
  if (x.contributed > 0n) return result('wait','Your share is funded','Wait for the other members. You may withdraw while collection remains open.',false);
  if (x.balance < x.share) return result('wait','Demo payment balance is insufficient','Add demo dUSD to this member wallet. Native tPOT pays fees, not the payment share.',false);
  if (x.allowance < x.share) return result('approve','Review exact-share approval','Approval permits the escrow to use your share. You must contribute afterwards.');
  return result('contribute','Review your contribution','Your approval is ready. This next transaction pays your fixed share.');
}
