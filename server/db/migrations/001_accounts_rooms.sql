CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, display_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), csrf_hash text NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS wallet_bindings (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), provider text NOT NULL,
 wallet_id text NOT NULL, owner_address text NOT NULL, account_address text NOT NULL,
 chain_id bigint NOT NULL, mode text NOT NULL CHECK(mode IN ('embedded-eoa','smart-account')),
 verified_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,provider,chain_id),
 UNIQUE(provider,wallet_id,chain_id), UNIQUE(chain_id,account_address)
);
CREATE TABLE IF NOT EXISTS wallet_challenges (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), message text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS rooms (
 id text PRIMARY KEY, merchant_id text NOT NULL REFERENCES users(id), title text NOT NULL,
 public_terms text NOT NULL, total text NOT NULL CHECK(total ~ '^[0-9]+$' AND total::numeric > 0),
 funding_deadline timestamptz NOT NULL, service_at timestamptz NOT NULL,
 revision integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'draft'
 CHECK(status IN ('draft','inviting','locked','publishing','published','cancelled')),
 terms_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS room_members (
 room_id text NOT NULL REFERENCES rooms(id), user_id text NOT NULL REFERENCES users(id),
 binding_id text NOT NULL REFERENCES wallet_bindings(id), nickname text NOT NULL,
 account_address text NOT NULL, share text NOT NULL CHECK(share ~ '^[0-9]+$' AND share::numeric > 0),
 PRIMARY KEY(room_id,user_id), UNIQUE(room_id,account_address)
);
CREATE TABLE IF NOT EXISTS room_acceptances (
 room_id text NOT NULL REFERENCES rooms(id), user_id text NOT NULL REFERENCES users(id),
 revision integer NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(room_id,user_id), FOREIGN KEY(room_id,user_id) REFERENCES room_members(room_id,user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
 id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id), token_hash text NOT NULL UNIQUE,
 recipient_user_id text REFERENCES users(id), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_slots (
 id text PRIMARY KEY, merchant_id text NOT NULL REFERENCES users(id), label text NOT NULL,
 capacity integer NOT NULL CHECK(capacity > 0), service_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_holds (
 id text PRIMARY KEY, slot_id text NOT NULL REFERENCES inventory_slots(id), room_id text NOT NULL UNIQUE REFERENCES rooms(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 5), status text NOT NULL
 CHECK(status IN ('draft','funding','confirmed','needs-review','released')), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_intents (
 id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id), revision integer NOT NULL,
 idempotency_key text NOT NULL UNIQUE, terms_hash text NOT NULL, chain_id bigint NOT NULL,
 escrow text NOT NULL, quote_id text NOT NULL, tx_hash text,
 status text NOT NULL CHECK(status IN ('prepared','submitted','unknown','finalized','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(room_id,revision)
);
CREATE TABLE IF NOT EXISTS quote_bindings (
 room_id text PRIMARY KEY REFERENCES rooms(id), revision integer NOT NULL, terms_hash text NOT NULL,
 chain_id bigint NOT NULL, escrow text NOT NULL, quote_id text NOT NULL, tx_hash text NOT NULL,
 block_number text NOT NULL, block_hash text NOT NULL, source text NOT NULL,
 UNIQUE(chain_id,escrow,quote_id)
);
CREATE TABLE IF NOT EXISTS templates (
 id text PRIMARY KEY, merchant_id text NOT NULL REFERENCES users(id), title text NOT NULL,
 public_terms text NOT NULL, total text NOT NULL, share_policy text NOT NULL CHECK(share_policy IN ('equal','custom')),
 duration_minutes integer NOT NULL CHECK(duration_minutes > 0), slot_type text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
