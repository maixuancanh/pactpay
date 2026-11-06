CREATE TABLE IF NOT EXISTS chain_events (
 chain_id bigint NOT NULL, tx_hash text NOT NULL, log_index integer NOT NULL,
 block_number text NOT NULL, block_hash text NOT NULL, escrow text NOT NULL,
 quote_id text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
 source text NOT NULL, coverage jsonb NOT NULL, contract_version text NOT NULL DEFAULT 'V1',
 PRIMARY KEY(chain_id,tx_hash,log_index)
);
CREATE TABLE IF NOT EXISTS indexer_cursors (
 stream text PRIMARY KEY, chain_id bigint NOT NULL, block_number text NOT NULL, block_hash text NOT NULL,
 coverage jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id text PRIMARY KEY REFERENCES users(id), in_app boolean NOT NULL DEFAULT true,
 email boolean NOT NULL DEFAULT false, timezone text NOT NULL DEFAULT 'UTC',
 quiet_start integer NOT NULL DEFAULT 22 CHECK(quiet_start BETWEEN 0 AND 23),
 quiet_end integer NOT NULL DEFAULT 8 CHECK(quiet_end BETWEEN 0 AND 23)
);
CREATE TABLE IF NOT EXISTS outbox (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), room_id text REFERENCES rooms(id),
 kind text NOT NULL, revision integer NOT NULL, payload jsonb NOT NULL,
 channel text NOT NULL DEFAULT 'in-app', dedup_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','cancelled')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 leased_until timestamptz, delivered_at timestamptz, last_error text
);
CREATE TABLE IF NOT EXISTS sponsorship_budgets (
 id text PRIMARY KEY, merchant_id text NOT NULL REFERENCES users(id), cap text NOT NULL,
 reserved text NOT NULL DEFAULT '0', spent text NOT NULL DEFAULT '0', enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sponsorship_reservations (
 id text PRIMARY KEY, budget_id text NOT NULL REFERENCES sponsorship_budgets(id),
 idempotency_key text NOT NULL UNIQUE, amount text NOT NULL, status text NOT NULL,
 authorization_data jsonb NOT NULL
);
