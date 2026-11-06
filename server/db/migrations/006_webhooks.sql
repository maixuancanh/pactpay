CREATE TABLE IF NOT EXISTS merchant_webhook_outbox (
 id text PRIMARY KEY, merchant_id text NOT NULL REFERENCES users(id), event_key text NOT NULL UNIQUE,
 payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), leased_until timestamptz, delivered_at timestamptz
);
