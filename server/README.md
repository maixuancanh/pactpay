# PactPay commerce backend

This Node TypeScript API persists accounts, wallet bindings, rooms and consent revisions, hashed invitations, inventory holds, publish intents, finalized chain evidence, notification outbox, booking templates and V1 support requests. Database writes never authorize spending.

## Run locally

```powershell
cd server
npm ci
npm run build
npm --prefix .. run compile
npm test
npm run dev:local
```

`dev:local` binds 127.0.0.1:8787 with a persistent PostgreSQL WASM database under `server/.local-data/`. APP_ORIGIN defaults to `http://127.0.0.1:5173`; Vite proxies `/api`. No local login impersonation endpoint exists. Google/Privy buttons remain unavailable without real provider configuration. Tests inject verified identity fixtures directly into server services; those fixtures never become a production authentication mode.

Local tests exercise real SQL migrations and transactions. This is **not** evidence for multi-process hosted PostgreSQL, Google consent, hosted email/OCR, V3 signing, smart accounts or sponsored transactions. Run against separate PostgreSQL before hosting.

## Production configuration

Use process environment or a deployment secret store; never VITE-prefixed server secrets. `npm run dev` requires `DATABASE_URL`, `APP_ORIGIN=https://your-app.example`. Secure HttpOnly SameSite=Lax session cookie, database-backed revocation, strict Origin + session CSRF for mutations. The API binds loopback behind your TLS reverse proxy. Run `npm run migrate` after taking a DB backup. Migrations are idempotent, recorded and serialized.

Authentication: `PRIVY_APP_ID`, `PRIVY_APP_SECRET` select the actual Privy app. Frontend calls POST `/api/auth/privy` with access token; server verifies token with current official `@privy-io/node` and fetches user by verified DID. Requires one linked Google account and exactly one Ethereum embedded wallet with provider ID and user signing enabled. A changed binding fails recovery closed. No email merging, wallet index guessing or server custody. Alternatively `GOOGLE_CLIENT_ID` enables verified GIS authentication only; it does **not** provision an embedded wallet. Ownership-challenge EOA binding is compatibility proof, not proof of provider recovery.

V1 finalized indexer: `INDEXER_RPC`, `INDEXER_ESCROW`, `INDEXER_START`, `CHAIN_ID` (default V3 420420777). Worker runs every 15s from deployment start with persisted cursor. RPC must implement genuine finalized block reads and historical contract calls. Never replace finalized with latest. Unknown coverage remains unknown. Quote creation verifies terms, merchant, total, funding/capture deadlines and immutable on-chain roster/shares; failed reads do not advance cursor. Pending unknown publish cannot create a second intent. Inventory is merchant/backend policy; funding/unknown holds never expire on a draft TTL.

V2 read registry/indexer: `PROTECTED_RPC`, `PROTECTED_ADDRESS`, `PROTECTED_DEPLOYMENT_BLOCK`. RPC URL is public browser configuration: no credentials/query. V2 events are version tagged and never interpreted by V1 room transitions. Global V2 Claimed events have no booking ID and use a zero quote ID; V2 balances require full ordered contract history plus finalized reads. Configuring a V2 address does not demonstrate audit or live acceptance.

Voluntary V1 refunds: `REFUND_RPC`, `REFUND_TOKEN` enable POST `/api/support/:id/reconcile`. Only successful finalized exact token/from/to/amount transfer matching original quote token can mark refunded. Unknown transfer remains pending. A merchant accepting a support request is not a transfer or chargeback guarantee. Attachment uploads are deliberately not exposed until private storage lifecycle is configured.

OCR: `OCR_ENDPOINT=https://processor.example/extract`, `OCR_ALLOWED_ORIGIN=https://processor.example`, `OCR_RECIPIENT=Named processor`, optional `OCR_BEARER_TOKEN`. Endpoint receives raw image bytes and must return the documented invoice schema. Browser must send `X-OCR-Consent-Recipient` exactly matching displayed recipient per upload. MIME is verified by sharp, limit 10MB / 20MP, 15s abort. Images stay in request memory; no original image is stored or published. Processor-side retention/deletion must be separately contracted and verified; local buffer deletion cannot guarantee remote deletion. All OCR results still require explicit human amount confirmation. Currency conversion is never automatic.

Email: `EMAIL_ENDPOINT=https://processor.example/send`, `EMAIL_ALLOWED_ORIGIN=https://processor.example`, `EMAIL_BEARER_TOKEN`. JSON delivery protocol `{to,kind,url,idempotencyKey}`; processor must honor `Idempotency-Key`. Only verified Privy Google email + explicit email preference enables delivery. Worker claims leased jobs, retries with bounded exponential backoff, suppresses stale reminders, obeys timezone/quiet hours and unsubscribe. External delivery is at-least-once; exactly-once requires processor idempotency. No Gmail scopes. This session configured no processor and sent no email. In-app delivery is committed atomically without external network.

Embed: `EMBED_ALLOWED_ORIGINS=https://merchant.example` comma-separated exact origins. POST `/api/embed/sessions` is authenticated merchant-only and binds finalized quote/origin/nonce/chain for <=15min. GET returns minimal metadata. Configure **the HTML document host** to emit `Content-Security-Policy: frame-ancestors 'self' https://merchant.example`; a header on the JSON API alone does not protect the embedded document. Signed merchant webhooks are implemented below; hosted cross-origin acceptance remains a release gate. Browser postMessage is never settlement proof.

Sponsorship policy/budget services implement transactional caps, nonce and idempotency binding, and preserve unknown reservations. `SponsoredSubmission` accepts only an injected verified native-sponsor/paymaster adapter, durably marks unknown before any dispatch, never resubmits unknown, reconciles through the adapter and settles actual execution/storage once. Local tests inject a clearly labeled test adapter for outage/duplicate/settlement cases. No actual sponsor execution transport is installed, no HTTP endpoint can trigger sends, and flags remain off until primitive, signer, approved finite budget and actual V3 proof exist. Operator configuration does not replace those proofs.

Merchant webhooks: `MERCHANT_WEBHOOK_DESTINATIONS` server-only JSON array `{merchantId,endpoint,allowedOrigin,secret}`. Endpoint must be exact allowlisted HTTPS; secret >=32 characters. Worker leases transactional finalized-event outbox, signs `timestamp + '.' + canonicalJSON(body)` with HMAC-SHA256 in `X-PactPay-Signature`, timestamp in `X-PactPay-Timestamp`, and stable event `Idempotency-Key`. Payload has delivery ID, version, chain/quote/event/block/hash, no profile/invite data. Merchant checks HMAC, timestamp replay window, delivery ID dedup and finalized chain read before fulfillment. Retries never invent a finalized outcome. No webhook destination or secret was configured or contacted in this session.

Payment execution: `PAYMENT_EXECUTION_CONFIG` server-only JSON with public `rpcUrl,token,escrow,maxExecutionFee,maxStorageDeposit,maxWalletCreationFee,estimateTtlMs,rpcDecimals,nativeDecimals,denominationEvidence` and `accountCapabilities` mapping exact lowercase address to `{verified:true,evidence,chainId,account}`. No wildcard. Server rejects mismatched chain/account, zero execution cap, invalid integers, unknown conversion and public RPC credential URLs. GET config returns only the logged-in canonical account's capability; unconfigured or unproved accounts receive null. Capability evidence is operator-supplied reference to actual earlier proof, never a substitute for the proof itself. Flags for smart account/batch/sponsor remain false.

Profile privacy: POST `/api/account/delete-private-profile` requires authenticated CSRF + exact confirmation string and removes private display/email/support/nickname/notification data, revokes sessions/invites. Ownership identity link remains for wallet recovery and financial rights, public terms/history cannot be erased. Provider information can be restored only by a later deliberate login.

Embedded backup/restore: stop API first. `npm run db:backup -- <data-dir> <NEW-private-snapshot-file>` writes without overwriting. `npm run db:restore -- <snapshot-file> <NEW-empty-data-dir>` restores an isolated target and runs idempotent migrations. Local test verifies isolated snapshot recovery and that editing restored copy cannot change original. Backups contain private data: store outside public exports and manage retention/access. This is not an offsite backup or hosted PostgreSQL restore proof. `npm run test:postgres` requires a dedicated `TEST_DATABASE_URL`, creates an isolated generated schema, exercises competing connections and drops only that schema; no silent skip. It has not been run without such a database.

See [API.md](API.md) for request/response schemas. Public receipts expose only finalized chain event data, never OAuth information, nicknames or private invitations. Production retention verification and hosted PostgreSQL backup/restore drills remain release gates; blockchain data cannot be deleted.

Official technical references checked during implementation: [Google token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Privy access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens), [node-postgres transactions](https://node-postgres.com/features/transactions), [PGlite](https://pglite.dev/docs/). SDK typings from installed exact versions were also read. No private key or remote credential was introduced.
