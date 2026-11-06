ALTER TABLE sponsorship_reservations ADD COLUMN IF NOT EXISTS tx_hash text;
ALTER TABLE sponsorship_reservations ADD COLUMN IF NOT EXISTS transport_id text;
