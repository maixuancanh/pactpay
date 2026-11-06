CREATE TABLE IF NOT EXISTS payment_attempts (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), room_id text NOT NULL REFERENCES rooms(id),
 chain_id bigint NOT NULL, account_address text NOT NULL, escrow text NOT NULL, quote_id text NOT NULL,
 action text NOT NULL, tx_hash text, status text NOT NULL CHECK(status IN ('prepared','submitted','unknown','finalized','failed')),
 state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,room_id,action)
);
