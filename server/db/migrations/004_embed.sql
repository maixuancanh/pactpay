CREATE TABLE IF NOT EXISTS embed_sessions (
 id text PRIMARY KEY, merchant_id text NOT NULL REFERENCES users(id), room_id text NOT NULL REFERENCES rooms(id),
 merchant_origin text NOT NULL, nonce text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 chain_id bigint NOT NULL, escrow text NOT NULL, quote_id text NOT NULL
);
