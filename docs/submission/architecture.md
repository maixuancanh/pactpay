# PactPay architecture and authority

Implemented target design, reviewed against source on 29 October 2026. The public frontend exists. The V3 contract/runtime interaction below remains a deployment target; local EVM tests do not prove Revive execution.

```mermaid
flowchart TB
  Merchant[Merchant] --> UI[React / TypeScript workspace]
  Member[Group member] --> UI
  Share[Agreement link / JSON / backup] --> Preview[Untrusted preview]
  Preview --> Verify[Explicit chain and code verification]
  Verify --> UI
  UI --> Store[Browser storage: drafts, packages, activity, pending intent]
  UI --> Native[Native adapter: review, dry-run, fee and storage deposit]
  Native --> Extension[Polkadot.js extension: user signature]
  Extension --> Runtime[Portaldot V3 runtime: deployed escrow, native signatures]
  Runtime --> Mapping[Runtime-controlled SS58 / H160 mapping]
  Mapping --> Escrow[PactPay Solidity escrow]
  UI --> EVM[Injected EVM wallet: EIP-712 and transactions]
  EVM --> Escrow
  Escrow --> Token[Fixed DemoUSD ERC-20, six decimals]
  Runtime --> Finality[Finality and dispatch checks]
  Escrow --> Readback[Code, quote, balance and liability readback]
  Finality --> UI
  Readback --> UI
```

The drawing describes two wallet paths to the same contract model. The current local native browser harness replaces extension/runtime transport with a simulated adapter and executes transactions against isolated Ganache. It does not execute the real runtime box. Test fixtures may reuse V3's chain ID; chain ID alone does not identify a public deployment.

## Contract lifecycle

```mermaid
stateDiagram-v2
  [*] --> Funding: merchant creates valid quote
  Funding --> Funding: member contributes or withdraws before deadline
  Funding --> Ready: exact total funded
  Funding --> Cancelled: merchant cancels
  Funding --> Expired: funding deadline reached and expiry called
  Ready --> Captured: merchant captures before capture deadline
  Ready --> Cancelled: merchant cancels
  Ready --> Expired: capture deadline reached and expiry called
  Captured --> MerchantCredit: capture allocates credit
  MerchantCredit --> MerchantPaid: merchant claims
  Cancelled --> MemberCredit: each contribution becomes refundable
  Expired --> MemberCredit: each contribution becomes refundable
  MemberCredit --> MemberRefunded: each member claims independently
```

Credit nodes explain accounting after a terminal collection state; they are not extra values of the Solidity `State` enum. Expiry is an explicit call, not a scheduled automatic transfer.

## Boundaries reviewers should inspect

| Boundary | Enforcement / source |
|---|---|
| Merchant authority | `contracts/PactPay.sol`: both creation routes require sender equals merchant; EVM route additionally verifies EIP-712 signature; native route relies on transaction authority |
| Immutable agreement | Chain/contract domain, unique merchant nonce, hashes of terms/member list/shares, fixed token and deadlines |
| Member authority | Listed caller contributes only their exact share; approval alone cannot contribute |
| Asset conservation | Deposits = pre-ready withdrawals + merchant payouts + member refunds + outstanding liability; direct donations can exceed liabilities |
| Native account identity | `src/native/adapter.ts`: runtime mapping and extension-controlled account, not a guessed SS58 substring |
| Untrusted import | `src/native/portability.ts`, `WorkspaceTransfer.tsx`: preview, validate deployment/quote on chain, then store; pending request blocks replacement |
| Transaction uncertainty | Persisted intent, finality/dispatch and readback; unresolved result blocks another send |
| Release isolation | `scripts/release.cjs`: production package excludes local deployment/quote fixtures |

No backend is required for the current MVP. Browser storage provides convenience and recovery context, not a trusted global order database. RPC availability and chain health affect operation; stale native state blocks signing. No product step guarantees merchant delivery. See [state machine](../state-machine.md) and [threat model](../threat-model.md).
