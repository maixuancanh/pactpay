# Threat model

Contract assumes a fixed standard ERC-20 with exact transfers and no rebase/fee. DemoUSD has an owner pause hook solely for transfer-failure drills; it is not a stablecoin. ReentrantToken is test-only and not deployed by setup.

Untrusted actors: member, merchant, frontend content/package, RPC, external token callback. Signatures/domain/nonce prevent replay; arrays bounded 1..5 and unique; shared state and CEI/reentrancy guard prevent duplicated claims; token transfer failure rolls back state. UI signature/terms verification does not replace contract checks.

Merchant signature proves who signed, not merchant identity, honest service delivery or legal enforceability. Once paid, merchant holds money; this MVP cannot force refund for nondelivery. Members can intentionally withdraw while Funding; that may prevent an order, as disclosed. Merchant can cancel before captured; everyone then claims independently.

EVM local tests do not prove Revive compatibility. No V3 deployed canary yet. EOA-only signing; contract wallets unsupported until ERC-1271 verification. Imported links expose wallet pseudonyms/terms publicly: never add PII. RPC failure/timeout remains unknown until receipt/state reconciliation. Crash before tx hash is persisted is a recovery limitation; never automatically reissue payment. Pending records are scoped to chain/contract.

Not audited; public test assets only. No production key custody, funds recovery admin, multi-chain, x402 or arbitrary external calls.
