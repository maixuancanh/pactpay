CREATE TABLE compact_relay_intents (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), room_id text NOT NULL REFERENCES rooms(id),
 reservation_id text NOT NULL REFERENCES sponsorship_reservations(id), budget_id text NOT NULL REFERENCES sponsorship_budgets(id),
 idempotency_key text NOT NULL UNIQUE, chain_id bigint NOT NULL, account_address text NOT NULL, account_nonce text NOT NULL,
 kind text NOT NULL, request jsonb NOT NULL, binding jsonb NOT NULL, status text NOT NULL,
 tx_hash text, journal jsonb, actual_execution text, actual_storage text, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compact_relay_active_nonce ON compact_relay_intents(chain_id,account_address,account_nonce) WHERE status IN ('quoted','submitting','submitted','unknown');
CREATE TABLE compact_relay_signer_lock (signer text PRIMARY KEY, intent_id text NOT NULL REFERENCES compact_relay_intents(id));
CREATE TABLE compact_relay_control (id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT true);
INSERT INTO compact_relay_control(id) VALUES(1);
