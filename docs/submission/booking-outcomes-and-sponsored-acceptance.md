# Booking outcomes and sponsored acceptance

Open `/booking#booking-outcomes` for a three-person workshop simulation. Each scenario has a shareable `/receipt?example=...` URL. The payout and cancellation refund examples link to separate recorded native testnet receipts. The complaint example describes the contract policy.

A published Protected V2 room links to its public receipt. The API reads member contributions, held funds and wallet credits at a finalized block. A finalized settlement event or an unambiguous contract state identifies the refund and payout allocation. Wallet credits are pooled across the contract. A claim without a booking ID cannot establish how much of its transfer belongs to that booking. The public receipt omits names, invitation links and attendance records.

The authenticated room lists voluntary attendance confirmations from members after the scheduled start. The API uses the signed-in member and server time. The confirmation belongs to the room and has no effect on money or complaint deadlines.

## Local acceptance

- `npm run test:contracts` runs the compact account contribution and refund against Protected V2. The buyer owner and buyer contract account have zero native balance. A distinct relayer pays execution and the merchant has a separate signer. The test verifies replay rejection, final buyer dUSD, zero remaining credit and zero contract liability.
- `npm run test:server` checks the existing V1 relay budget boundary and reservation recovery. A per-room daily cap below the fee and storage reservation blocks the request before signing. The separate total booking cap, `maxPerRoom`, counts unreleased commitments across days and merchant budgets. It defaults to the daily booking cap and conservatively counts the authorized maximum. The suite also checks the Protected V2 receipt and private attendance rules.
- Run `node scripts/indexed-receipt-browser.cjs` with the web server running. It exercises all three mobile examples and the public receipt unavailable/retry path with a fixture API.

## Portaldot V3 acceptance still required

## Prepared Protected V2 sponsorship

Protected V2 now has its own relay planner, acceptance-file verifier and checkout integration. Its operator instance is isolated from the V1 relay. The server reconstructs exact calls from the locked roster and finalized contract state. Browser-provided amounts, recipients or arbitrary calls are not accepted.

| Action | Authorized calls |
| --- | --- |
| Open payments | `create` with agreed roster, shares, terms hash and deadlines |
| Pay a share | Exact `approve` followed by `contribute`, atomically |
| Cancel | Merchant `cancel` |
| Receive a refund | Eligible `settle` followed by pooled `claim`, atomically |
| Receive merchant funds | `capture`, then a later eligible `settle` + `claim` after the complaint window |

An already-settled position can claim existing credit. Claim transfers the actor's entire contract credit, including any other bookings. Capture is never presented as receipt of money. Complaint and negotiated-resolution controls remain on the existing wallet path.

A Google user can choose **Merchant-covered fees** only when their registered payment account matches the fixed account on the booking. Existing bookings retain their original account. A compact account cannot take ownership of a booking assigned to a different Google or native wallet.

The prepared path reserves the maximum execution and storage costs, respects the total booking cap across days and budgets, serializes the account nonce and signer, journals a hash before broadcast, reconciles unknown submissions without resending, and binds finalized V2 events back to the room. Cancellation opens the refund path; it does not transfer a buyer's credit.

### Operator setup, left disabled

Use separate V2 operator files; V1 continues to use `COMPACT_RELAY_*`.

```dotenv
PROTECTED_RELAY_ENABLED=false
# Absolute paths outside the repository; do not commit signer material.
PROTECTED_RELAY_SIGNER_FILE=/run/secrets/pactpay-protected-relayer
PROTECTED_RELAY_POLICY_FILE=/run/config/pactpay-protected-policy.json
PROTECTED_RELAY_ACCEPTANCE_FILE=/run/config/pactpay-protected-acceptance.json
```

Copy `server/sponsorship/protected-policy.example.json` to private operator configuration. Replace the merchant allowlist, choose caps from real runtime estimates and fund the approved operator separately when live work resumes. Amounts in this example use native base units (14 decimals); they are policy ceilings, not quotes or measured charges. A saved merchant budget does not fund the relayer.

The V2 policy must declare `version: protected-v2` and match the configured Protected V2 contract. The acceptance file uses schema `pactpay-native-relay-acceptance-v2`; its executions must provide finalized evidence for publish, payment, capture, payout, refund and cancel. The server checks compact ownership, signer, decoded target calls and finalized cost accounting. No environment flag bypasses missing acceptance evidence.

At the user's request, no new automated scenario or live V3 transaction was run for this preparation. Only TypeScript and production build checks were performed. V2 sponsorship remains unavailable until operator setup and V3 acceptance are completed. No additional contract deployment is needed for this path.

## Deferred Portaldot V3 acceptance

1. Record separate merchant, buyer owner, buyer payment-account and operator addresses. Verify the buyer's native balance before the first action. The buyer needs the exact dUSD share and an account already registered for the tested execution path.
2. Estimate the payment and the cancellation/refund path separately. Include fee and storage for both in the operator budget. Check the daily per-booking, per-account and global caps before any signature. Preserve a reservation when broadcast status is unknown.
3. Verify the exact reviewed calls and the finalized contribution. For the refund test, the merchant cancels while collecting and a separate sponsored action settles and receives the buyer credit. Record who paid, actual fee, actual storage, event and balance changes, native hash and finalized block for each action.
4. Reproduce an exhausted booking cap and repeat a submitted request. Verify the first fails before signing and the second recovers the existing result. Confirm the buyer stayed at zero native balance, received the original dUSD share and the booking carries no residual liability.

The local Hardhat execution does not measure V3 runtime storage deposits. Existing native payout and refund receipts were signed directly. Neither establishes V3 sponsorship.
