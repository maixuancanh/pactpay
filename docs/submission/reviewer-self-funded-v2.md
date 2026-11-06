# Reviewer guide: use your own testnet funds

The public application exposes Protected V2 with wallet-paid network costs. Reviewers can use their own Google wallet or Polkadot.js account. A reviewer with an already deployed, registered compact payment account can also combine payment calls and choose a separate native fee payer directly in Group bookings.

This is distinct from the unattended operator relay. Browser-paid execution does not require a server signing key, an operator allowlist or a merchant automatic-coverage budget. The chosen wallet confirms its own exact costs. The unattended relay remains separately configured and cannot spend the project's funds by default.

## Start with two ordinary wallets

1. Open `/booking` and connect the organizer wallet. Google sign-in creates or restores its wallet; an existing native wallet can sign in through Polkadot.js.
2. Create a booking. Protected V2 is selected by default when its deployment is configured. Enter a small demo dUSD total, future deadlines and clear public terms.
3. Open the invitation with a different participant wallet. Join and agree to the displayed share.
4. Return as organizer, lock the agreement and open payments. Review the live network estimate and confirm in the chosen wallet.
5. Open the participant checkout from the invitation. Approve the exact share and contribute.
6. To try a refund, have the organizer cancel before capture. The participant settles the eligible refund and claims the available credit. To try a payout, fully fund the booking, capture, wait through its complaint policy, settle and claim as organizer.
7. Inspect contributions and outcomes in the room and its public receipt. A captured payment, available credit and an actual transfer are distinct states.

Ordinary Google and native wallets keep the existing complaint and mutually signed resolution controls. Using another payment account does not migrate an old booking or change its member wallet.

## Combined calls with a chosen fee payer

This optional path requires a compact account already deployed for the Google owner and linked in Profile. Linking checks ownership and runtime; it does not deploy an account. Enable it for new bookings and explicitly choose it when creating or joining a room. Existing rooms keep their fixed accounts.

In the V2 checkout:

1. Select **Combined payment · choose fee payer**.
2. Connect the Polkadot.js wallet that will pay costs. It may belong to the organizer or the reviewer.
3. Set the maximum total cost. The app reads its available native balance. This limit is a ceiling, not an upfront payment.
4. Review the exact booking action, then sign once with the Google owner. Approval plus contribution, or settlement plus claim, are encoded as one atomic execution.
5. Review the simulated gas and storage deposit, then authorize that exact execution in Polkadot.js. The fee payer has a separate signature because it is a separate authority.
6. If interrupted after submission, use **Recover previous execution**. The app preserves the original native intent and hash and does not automatically resend it.

The read-only `/api/rooms/:roomId/protected-fee-plan` endpoint reconstructs calls from the locked, authenticated room and finalized V3 reads. It verifies the registered compact runtime and owner, binds the selected fee payer and preserves exact calls during signing. It has no server signing or broadcasting capability. Finalized execution is attached to the room through the existing receipt-verification endpoints.

Complaint and negotiated-resolution controls remain on the ordinary fixed-wallet path; the optional compact checkout covers publish, contribution, capture, cancellation, settlement and pooled credit claims.

## Two different test tokens

- **tPOT** pays network execution and storage deposits. It is required in the signing wallet or the separate chosen native fee payer. Deposits depend on stored data, not the demo payment amount; use the live review rather than assuming a tiny dUSD share means tiny native cost.
- **demo dUSD** is the payment asset bound to the deployed escrow. The contributor needs their exact share in the booking's fixed account. Contract: `0x85c6d3f215f972459fcc7f816eb4c5733aadcd4a`, six decimals.

The current demo token is owner-minted, not a public faucet. Reviewers must obtain an allocation from the test-token owner or receive a transfer from a funded test wallet before contributing. Adding tPOT does not mint dUSD. No seed phrase or private key should be shared. If no allocation is available, the three public booking examples and their recorded evidence remain inspectable without a wallet, but they are not a new live payment.

## Release status

This release enables browser-authorized fee payment. TypeScript and production builds are checked. At the project owner's request, no new live transaction or paid V3 acceptance run was performed for this release. The public capability `protectedManualSponsoring` identifies the user-selected payer route; `protectedSponsoring` separately reports unattended operator coverage and is not used to mislabel self-paid gas.
