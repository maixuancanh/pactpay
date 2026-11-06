import type { Database } from "../db/database.js";
import { requireThat } from "../lib.js";
export async function deletePrivateProfile(
  db: Database,
  userId: string,
  confirmation: unknown,
) {
  requireThat(
    confirmation === "DELETE_PRIVATE_PROFILE",
    "privacy_confirmation_required",
  );
  return db.transaction(async (tx) => {
    await tx.query(
      "UPDATE users SET display_name='Deleted profile',notification_email=NULL WHERE id=$1",
      [userId],
    );
    await tx.query(
      "UPDATE room_members SET nickname='Member' WHERE user_id=$1",
      [userId],
    );
    await tx.query(
      "UPDATE support_requests SET reason='Removed at user request' WHERE user_id=$1",
      [userId],
    );
    await tx.query("DELETE FROM notification_preferences WHERE user_id=$1", [
      userId,
    ]);
    await tx.query(
      "UPDATE outbox SET status='cancelled',payload='{}'::jsonb WHERE user_id=$1",
      [userId],
    );
    await tx.query(
      "UPDATE invitations SET revoked_at=now() WHERE recipient_user_id=$1 OR room_id IN (SELECT id FROM rooms WHERE merchant_id=$1)",
      [userId],
    );
    await tx.query("DELETE FROM wallet_challenges WHERE user_id=$1", [userId]);
    await tx.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [
      userId,
    ]);
    // Keep the provider subject/canonical wallet and immutable room financial links to avoid losing access or rebinding old rights.
    return {
      deletedPrivateProfile: true,
      retained: [
        "canonical-identity-link",
        "wallet-ownership-binding",
        "financial-audit",
        "public-terms",
        "blockchain-history",
      ],
      notice:
        "Public terms and blockchain history cannot be erased. Canonical ownership links remain for recovery.",
    };
  });
}
