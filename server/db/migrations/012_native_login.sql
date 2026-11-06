ALTER TABLE wallet_bindings DROP CONSTRAINT wallet_bindings_mode_check;
ALTER TABLE wallet_bindings ADD CONSTRAINT wallet_bindings_mode_check CHECK(mode IN ('embedded-eoa','smart-account','native'));
CREATE TABLE native_login_challenges (
 id text PRIMARY KEY,
 context_hash text NOT NULL,
 public_key text NOT NULL,
 native_address text NOT NULL,
 message text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz
);
