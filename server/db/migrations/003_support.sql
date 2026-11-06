CREATE TABLE IF NOT EXISTS support_requests (
 id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id), user_id text NOT NULL REFERENCES users(id),
 amount text NOT NULL CHECK(amount ~ '^[0-9]+$' AND amount::numeric > 0), reason text NOT NULL,
 idempotency_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','rejected','transfer-pending','refunded')),
 transfer_hash text, verified_amount text NOT NULL DEFAULT '0', nonce text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(transfer_hash)
);
CREATE TABLE IF NOT EXISTS support_audit (
 id text PRIMARY KEY, request_id text NOT NULL REFERENCES support_requests(id),
 actor_id text NOT NULL REFERENCES users(id), kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
