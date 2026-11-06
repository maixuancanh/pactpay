CREATE TABLE atomic_accounts (
 user_id text NOT NULL REFERENCES users(id), binding_id text NOT NULL REFERENCES wallet_bindings(id),
 chain_id bigint NOT NULL, account_address text NOT NULL, owner_address text NOT NULL,
 active boolean NOT NULL DEFAULT false, verified_at timestamptz NOT NULL DEFAULT now(),
 block_number text NOT NULL, block_hash text NOT NULL, genesis text NOT NULL, runtime_hash text NOT NULL,
 PRIMARY KEY(user_id,chain_id), UNIQUE(chain_id,account_address)
);
ALTER TABLE rooms ADD COLUMN merchant_account_address text;
ALTER TABLE rooms ADD COLUMN account_chain_id bigint;
ALTER TABLE room_members ADD COLUMN atomic_account_address text;
