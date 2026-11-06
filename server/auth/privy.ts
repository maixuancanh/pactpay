import { PrivyClient } from "@privy-io/node";
import type { Database, Row } from "../db/database.js";
import { address, hash, id, requireThat, token } from "../lib.js";
import { upsertIdentity } from "./session.js";
export async function privyLogin(
  db: Database,
  appId: string,
  appSecret: string,
  chainId: number,
  accessToken: string,
) {
  const privy = new PrivyClient({
    appId,
    appSecret,
    timeout: 15000,
    maxRetries: 1,
  });
  let profile: Row;
  try {
    const verified = await privy.utils().auth().verifyAccessToken(accessToken);
    profile = await privy.users()._get(verified.user_id);
    requireThat(
      profile.id === verified.user_id,
      "identity_mismatch",
      undefined,
      401,
    );
  } catch {
    requireThat(false, "invalid_privy_token", "Privy verification failed", 401);
  }
  return persistPrivyProfile(db, appId, chainId, profile!);
}
/** Input must come exclusively from authenticated Privy server API, never browser JSON. */
export async function persistPrivyProfile(
  db: Database,
  appId: string,
  chainId: number,
  profile: Row,
) {
  requireThat(
    typeof profile.id === "string" && Array.isArray(profile.linked_accounts),
    "invalid_privy_profile",
    undefined,
    401,
  );
  const google = profile.linked_accounts.filter(
    (a: Row) => a.type === "google_oauth",
  );
  requireThat(google.length === 1, "google_identity_required", undefined, 403);
  const wallets = profile.linked_accounts.filter(
    (a: Row) =>
      a.type === "wallet" &&
      a.wallet_client_type === "privy" &&
      a.chain_type === "ethereum",
  );
  requireThat(
    wallets.length === 1 &&
      typeof wallets[0].id === "string" &&
      wallets[0].user_can_sign === true,
    "canonical_embedded_wallet_required",
    "A single user controlled embedded Ethereum wallet with a stable provider ID is required",
    409,
  );
  const wallet = wallets[0],
    account = address(wallet.address),
    provider = `privy:${appId}`;
  return db.transaction(async (tx) => {
    const user = await upsertIdentity(tx, {
      issuer: provider,
      subject: profile.id,
      displayName:
        typeof google[0].name === "string"
          ? google[0].name.slice(0, 100)
          : "Member",
    });
    // Serialize two devices for this canonical account before insert.
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    if (typeof google[0].email === "string")
      await tx.query("UPDATE users SET notification_email=$2 WHERE id=$1", [
        user.id,
        google[0].email,
      ]);
    const old = (
      await tx.query(
        "SELECT * FROM wallet_bindings WHERE user_id=$1 AND chain_id=$2",
        [user.id, chainId],
      )
    ).rows[0];
    if (old)
      requireThat(
        old.provider === provider &&
          old.wallet_id === wallet.id &&
          old.account_address === account,
        "binding_changed",
        "Canonical wallet changed; recovery required before signing",
        409,
      );
    const binding =
      old ??
      (
        await tx.query(
          "INSERT INTO wallet_bindings(id,user_id,provider,wallet_id,owner_address,account_address,chain_id,mode) VALUES($1,$2,$3,$4,$5,$5,$6,'embedded-eoa') RETURNING *",
          [id(), user.id, provider, wallet.id, account, chainId],
        )
      ).rows[0];
    const sessionToken = token(),
      csrfToken = token();
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)",
      [
        hash(sessionToken),
        user.id,
        hash(csrfToken),
        new Date(Date.now() + 8 * 3600000),
      ],
    );
    return {
      user,
      binding: {
        walletId: binding.wallet_id,
        ownerAddress: binding.owner_address,
        accountAddress: binding.account_address,
        chainId: Number(binding.chain_id),
        mode: binding.mode,
      },
      sessionToken,
      csrfToken,
    };
  });
}
