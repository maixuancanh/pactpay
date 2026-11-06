import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Database, Sql } from "../db/database.js";
import { hash, id, requireThat, token } from "../lib.js";
export type Identity = { issuer: string; subject: string; displayName: string };
export type IdentityVerifier = (credential: string) => Promise<Identity>;
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export function googleVerifier(clientId: string): IdentityVerifier {
  return async (credential) => {
    const { payload } = await jwtVerify(credential, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      algorithms: ["RS256"],
      maxTokenAge: "2h",
    });
    requireThat(
      payload.sub && payload.exp && payload.iat,
      "invalid_identity",
      undefined,
      401,
    );
    return {
      issuer: "https://accounts.google.com",
      subject: payload.sub,
      displayName:
        typeof payload.name === "string"
          ? payload.name.slice(0, 100)
          : "Member",
    };
  };
}
export async function upsertIdentity(tx: Sql, identity: Identity) {
  const result = await tx.query(
    `INSERT INTO users(id,issuer,subject,display_name) VALUES($1,$2,$3,$4)
 ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING *`,
    [id(), identity.issuer, identity.subject, identity.displayName],
  );
  return result.rows[0];
}
export class Sessions {
  constructor(
    private db: Database,
    private verify?: IdentityVerifier,
  ) {}
  async login(credential: string) {
    requireThat(
      this.verify,
      "google_not_configured",
      "Google authentication is not configured",
      503,
    );
    const identity = await this.verify(credential); // subject never read from request body
    return this.db.transaction(async (tx) => {
      const user = await upsertIdentity(tx, identity);
      const sessionToken = token(),
        csrfToken = token();
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)",
        [
          hash(sessionToken),
          user.id,
          hash(csrfToken),
          new Date(Date.now() + 8 * 3600_000),
        ],
      );
      return { user, sessionToken, csrfToken };
    });
  }
  async get(sessionToken?: string) {
    if (!sessionToken) return null;
    return (
      (
        await this.db.query(
          `SELECT u.*,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
          [hash(sessionToken)],
        )
      ).rows[0] ?? null
    );
  }
  async logout(sessionToken: string) {
    await this.db.query(
      "UPDATE sessions SET revoked_at=now() WHERE token_hash=$1",
      [hash(sessionToken)],
    );
  }
  async rotateCsrf(sessionToken: string) {
    const csrfToken = token();
    await this.db.query(
      "UPDATE sessions SET csrf_hash=$2 WHERE token_hash=$1",
      [hash(sessionToken), hash(csrfToken)],
    );
    return csrfToken;
  }
}
