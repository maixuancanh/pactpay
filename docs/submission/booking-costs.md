# PactPay booking costs

4 November 2026, Portaldot V3 Testnet. Booking amounts are in demo dUSD. Execution fees and storage deposits are in native tPOT. The direct native signer pays the network cost for each action. A separate named payer is used only when the reviewed execution explicitly assigns one.

## Setup

The current checkout can reuse the existing dUSD, native escrow and compact executor. The incremental deployment deposit for that route is zero. Creating a booking and using the existing contracts can still incur execution fees and storage deposits.

The Protected V2 constructor simulated successfully with the existing dUSD token and 10,564 bytes of initialization code. The unsigned review in `evidence/protected-v2-unsigned-review.json` records a maximum storage deposit of **745.0035 tPOT** and an estimated transaction fee of **1.069309582877 tPOT**. This estimate covers a fresh code upload. Re-estimate at signing and verify the finalized deployment receipt before using the predicted address.

## Per booking

These figures model new storage writes for one-member 0.01 dUSD test bookings, using current V3 deposit constants and local contract traces. They exclude execution fees and released deposits. The fee for each live call comes from its fresh runtime review. A zero modeled deposit still allows a nonzero fee.

| Action | Direct payer | Modeled gross storage deposit |
| --- | --- | ---: |
| Publish booking | Merchant | 42.2565 tPOT |
| Approve escrow | Member | 3.8415 tPOT in fixture |
| Contribute | Member | 15.366 tPOT |
| Capture | Merchant | 3.8415 tPOT |
| Claim payout | Merchant | 0 tPOT |
| Cancel after a contribution | Merchant | 3.8415 tPOT |
| Claim refund after cancellation | Member | 0 tPOT |
| Expire an uncaptured booking | Caller | 3.8415 tPOT |
| Claim refund after expiry | Member | 0 tPOT |

Using the fixture approval as a planning allowance, capture, cancellation and expiry each total **65.3055 tPOT** in modeled gross storage writes before fees and released deposits. The expiry fixture covered an uncaptured booking after its capture deadline. The fixture reused one approval across three bookings. Review each member's exact share and current allowance before live signing.

Minting test funds is separate from checkout. The local model counted 7.683 tPOT of storage writes on a fresh fixture. The live mint simulation for an already initialized account returned zero maximum storage charge. Account and slot state explain why these numbers can differ.

Reproduce with `node scripts/acceptance-budget.cjs`. The output in `evidence/v3-acceptance-budget.json` records the finalized state reference and local measurements. Record actual fee, payer, block, transaction hash, and observed deposit changes from the live run before publishing per-transaction totals.
