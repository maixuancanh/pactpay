CREATE TABLE eoa_execution_proofs (
 account_address text NOT NULL,
 chain_id bigint NOT NULL,
 tx_hash text NOT NULL,
 block_hash text NOT NULL,
 block_number text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_address,chain_id)
);
