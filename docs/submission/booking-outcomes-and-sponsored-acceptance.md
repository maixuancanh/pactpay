# Booking outcomes and sponsored acceptance

Open `/booking#booking-outcomes` for a three-person workshop simulation. Each scenario has a shareable `/receipt?example=...` URL. The payout and cancellation refund examples link to separate recorded native testnet receipts. The complaint example describes the contract policy.

A published Protected V2 room links to its public receipt. The API reads member contributions, held funds and wallet credits at a finalized block. A finalized settlement event or an unambiguous contract state identifies the refund and payout allocation. Wallet credits are pooled across the contract. A claim without a booking ID cannot establish how much of its transfer belongs to that booking. The public receipt omits names, invitation links and attendance records.

The authenticated room lists voluntary attendance confirmations from members after the scheduled start. The API uses the signed-in member and server time. The confirmation belongs to the room and has no effect on money or complaint deadlines.

## Local acceptance

- `npm run test:contracts` runs the compact account contribution and refund against Protected V2. The buyer owner and buyer contract account have zero native balance. A distinct relayer pays execution and the merchant has a separate signer. The test verifies replay rejection, final buyer dUSD, zero remaining credit and zero contract liability.
- `npm run test:server` checks the existing V1 relay budget boundary and reservation recovery. A per-room daily cap below the fee and storage reservation blocks the request before signing. The separate total booking cap, `maxPerRoom`, counts unreleased commitments across days and merchant budgets. It defaults to the daily booking cap and conservatively counts the authorized maximum. The suite also checks the Protected V2 receipt and private attendance rules.
- Run `node scripts/indexed-receipt-browser.cjs` with the web server running. It exercises all three mobile examples and the public receipt unavailable/retry path with a fixture API.

## Portaldot V3 acceptance still required

The automatic relay policy and acceptance file currently cover the V1 escrow. Protected V2 uses different call selectors and pooled claims. Keep V2 fee sponsorship unavailable in public checkout until its policy, cost accounting and finalized receipts are accepted for that contract.

1. Record separate merchant, buyer owner, buyer payment-account and operator addresses. Verify the buyer's native balance before the first action. The buyer needs the exact dUSD share and an account already registered for the tested execution path.
2. Estimate the payment and the cancellation/refund path separately. Include fee and storage for both in the operator budget. Check the daily per-booking, per-account and global caps before any signature. Preserve a reservation when broadcast status is unknown.
3. Verify the exact reviewed calls and the finalized contribution. For the refund test, the merchant cancels while collecting and a separate sponsored action settles and receives the buyer credit. Record who paid, actual fee, actual storage, event and balance changes, native hash and finalized block for each action.
4. Reproduce an exhausted booking cap and repeat a submitted request. Verify the first fails before signing and the second recovers the existing result. Confirm the buyer stayed at zero native balance, received the original dUSD share and the booking carries no residual liability.

The local Hardhat execution does not measure V3 runtime storage deposits. Existing native payout and refund receipts were signed directly. Neither establishes V3 sponsorship.
