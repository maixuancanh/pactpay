ALTER TABLE rooms ADD COLUMN settlement_version text NOT NULL DEFAULT 'v1' CHECK (settlement_version IN ('v1','protected-v2'));
ALTER TABLE rooms ADD COLUMN complaint_seconds integer NOT NULL DEFAULT 3600 CHECK (complaint_seconds BETWEEN 60 AND 31536000);
ALTER TABLE rooms ADD COLUMN resolution_seconds integer NOT NULL DEFAULT 86400 CHECK (resolution_seconds BETWEEN 60 AND 31536000);
CREATE TABLE protected_room_bindings (
 room_id text PRIMARY KEY REFERENCES rooms(id),
 revision integer NOT NULL,
 quote_id text NOT NULL,
 escrow text NOT NULL,
 chain_id bigint NOT NULL,
 block_number text NOT NULL,
 block_hash text NOT NULL,
 tx_hash text NOT NULL,
 UNIQUE(chain_id,escrow,quote_id)
);
CREATE TABLE protected_room_events (
 room_id text NOT NULL REFERENCES rooms(id),
 tx_hash text NOT NULL,
 log_index integer NOT NULL,
 block_number text NOT NULL,
 block_hash text NOT NULL,
 event_name text NOT NULL,
 event_args jsonb NOT NULL,
 PRIMARY KEY(room_id,tx_hash,log_index)
);
