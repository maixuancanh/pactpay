# API deployment and PostgreSQL acceptance

The frontend is static; the API needs a long-running Node24 host, PostgreSQL and background workers. API process runs migrations on startup and notification/indexer workers in the same process. Do not deploy this process as a short-lived static function and call workers operational.

## Build the isolated server image

From the project root:

```powershell
docker build -t pactpay-api:local ./server
```

The build context excludes `.env`, `.local-data`, dependency caches and backup files. Provide credentials at runtime via the hosting environment/secrets facility. App ID is public; App Secret and DATABASE_URL remain server-only. No secret is built into the image. HOST=0.0.0.0 is only for the container interface; expose the API through HTTPS with appropriate network access controls.

Required production variables: DATABASE_URL, APP_ORIGIN (exact HTTPS frontend origin), PRIVY_APP_ID, PRIVY_APP_SECRET. Optional services and their allowlists are described in `server/README.md`. `PORT=8787` by default. Set `PACTPAY_API_ORIGIN` when building frontend release so `/api` goes to that API. Configure CSP frame-ancestors consistently with embed session origin allowlist.

1. Run `npm ci`, `npm run build`, `npm test` in server before packaging.
2. Back up production PostgreSQL using provider snapshot or pg_dump. Restore into a new database and verify migrations, room/invitation counts and pending attempts; never test recovery by overwriting the original.
3. Start the API and check `/health`; this proves database connectivity, not worker delivery or wallet execution.
4. Run an anonymous session and Google login on the exact hosted frontend origin. Verify HttpOnly/Secure session cookie, CSRF and cross-user access isolation through the proxy.
5. Configure indexer starting at deployment block. Confirm persisted finalized cursor, event deduplication and outage recovery. Native and EVM block namespaces must remain explicit.
6. Test signed webhook retries against merchant endpoint; verify signature and eventId before fulfillment. Configure a real sender/OCR processor only after destination and data handling are accepted.

## Dedicated PostgreSQL concurrency test

`npm run test:postgres` in server requires a dedicated TEST_DATABASE_URL. The test creates a unique temporary schema and drops only that schema in finally. It does not fall back silently to PGlite. It proves separate connection locking for the final inventory seat and migrations; it does not substitute for provider backup acceptance or a full load test.

Docker can supply a disposable local PostgreSQL if its engine is running. Use a random locally generated test password, bind database port to127.0.0.1 only, and keep the password out of command logs/source. Do not point the test at a database whose schema you cannot independently recover. Local container execution must be recorded separately from hosted PostgreSQL.

## Current verification scope

Docker Desktop subsequently started successfully. The API image built, and an isolated Node24 API container connected to PostgreSQL17, ran migrations and passed `/health`; evidence: `evidence/api-container-health.json`. No provider credentials were placed in this test container. The dedicated real PostgreSQL concurrency test passed after an initial startup/connection failure; test containers and their temporary network were removed. These are local container checks, not hosted deployment or production backup proof.
