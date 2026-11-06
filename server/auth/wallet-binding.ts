import { verifyMessage } from "viem";
import type { Database } from "../db/database.js";
import { address, id, integer, requireThat, token } from "../lib.js";
export class WalletBindings {
  constructor(
    private db: Database,
    private origin: string,
  ) {}
  async get(userId: string, chainId: number) {
    return (
      (
        await this.db.query(
          "SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2",
          [userId, chainId],
        )
      ).rows[0] ?? null
    );
  }
  async challenge(userId: string, chainId: number, account: unknown) {
    const chain = integer(chainId, 1, Number.MAX_SAFE_INTEGER),
      wallet = address(account),
      challengeId = id();
    const message = `PactPay account ownership\nOrigin: ${this.origin}\nUser: ${userId}\nAddress: ${wallet}\nChain: ${chain}\nNonce: ${token()}\nChallenge: ${challengeId}\nNo spending authorization. This establishes an EOA binding only.`;
    await this.db.query(
      "INSERT INTO wallet_challenges(id,user_id,message,expires_at) VALUES($1,$2,$3,$4)",
      [challengeId, userId, message, new Date(Date.now() + 300_000)],
    );
    return { id: challengeId, message };
  }
  async bind(userId: string, challengeId: string, signature: `0x${string}`) {
    return this.db.transaction(async (tx) => {
      const c = (
        await tx.query(
          "SELECT * FROM wallet_challenges WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [challengeId, userId],
        )
      ).rows[0];
      requireThat(
        c && !c.consumed_at && new Date(c.expires_at).getTime() > Date.now(),
        "invalid_challenge",
        undefined,
        403,
      );
      const account = c.message.match(/Address: (0x[0-9a-f]{40})/)?.[1],
        chainId = Number(c.message.match(/Chain: (\d+)/)?.[1]);
      requireThat(account, "invalid_challenge");
      requireThat(
        await verifyMessage({
          address: account as `0x${string}`,
          message: c.message,
          signature,
        }),
        "invalid_wallet_signature",
        undefined,
        403,
      );
      const existing = (
        await tx.query(
          "SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2 FOR UPDATE",
          [userId, chainId],
        )
      ).rows[0];
      if (existing) {
        requireThat(
          existing.account_address === account,
          "binding_changed",
          "Existing canonical wallet differs; recovery required",
          409,
        );
        return existing;
      }
      // Caller proved this exact EOA, not a claimed embedded provider wallet or smart account.
      const row = (
        await tx.query(
          `INSERT INTO wallet_bindings(id,user_id,provider,wallet_id,owner_address,account_address,chain_id,mode) VALUES($1,$2,'ownership-challenge',$3,$3,$3,$4,'embedded-eoa') RETURNING *`,
          [id(), userId, account, chainId],
        )
      ).rows[0];
      await tx.query(
        "UPDATE wallet_challenges SET consumed_at=now() WHERE id=$1",
        [challengeId],
      );
      return row;
    });
  }
}
