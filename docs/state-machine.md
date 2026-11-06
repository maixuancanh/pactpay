# PactPay state machine

| State/action | Actor | Condition | Result |
|---|---|---|---|
| create | signed merchant | unique nonce, valid arrays, now < funding < capture | Funding |
| contribute | listed member | Funding, now < funding, terms match, unpaid share | held/ liability increase; Ready at exact total |
| withdraw | contributed member | Funding, now < funding | full share returns, held/liability decrease |
| capture | merchant | Ready, now < capture | Captured, held becomes merchant credit |
| cancel | merchant | Funding/Ready | Cancelled, contributions become member credits |
| expire | anyone | Funding now >= funding, or Ready now >= capture | Expired, refund credits |
| claim | credit owner | credit > 0 | credit/liability decrease, token transfer |

Cancelled/Expired/Captured are terminal for order lifecycle. Claim remains available, independent of others. No automatic keeper is required; users can call expiry/claim. Exact boundary uses `<` for funding/capture and `>=` for expiry. Capture and claim are separate transactions. Changing terms requires cancelling and a new quote, not migrating money.
