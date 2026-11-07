# Demo plan (2 minutes) and judge prep

## Setup (do this before you present, never cold-load)
- Devnet program deployed, IDL in `app/src/idl/daylight.json`, own RPC key in `app/.env`.
- Five browser profiles or windows, each with its own Phantom account on devnet:
  **Org**, **Donor**, **Recipient A**, **Recipient B**, **Recipient C**.
  Use separate windows instead of switching accounts live.
- Fund Org and Donor with a few devnet SOL; recipients need only a sliver for fees.
- Pre-open: the app (Explore), Solana Explorer on the program, and `npm run verify` in a terminal.
- Pre-create the org and one campaign ("Term 2 school fees") with a donation already made.
- Record a backup video of the full run first.

## Script
1. **(15s) The problem.** "Every aid system has one narrator: the payer. The org says we delivered.
   Daylight adds the second signature."
2. **(25s) Org pays three people.** Org window: pay Recipient A, B, C 0.01 SOL each, attaching a
   receipt hash. Show the Explore score at **0%** with three "awaiting reply".
3. **(35s) The recipients answer.** Recipient A and B windows: *My payouts*, confirm. Recipient C:
   **dispute**. Refresh Explore: **67% confirmed, 1 disputed**. "The org could not touch that number.
   Only these three wallets could change it."
4. **(25s) Don't trust the website.** Terminal: `npm run verify -- <rpc> <org-wallet>`. It recomputes
   the score from raw on-chain accounts and prints `OK: the org account matches the raw payouts`.
5. **(10s) Privacy and limits, out loud.** "No child data on-chain, only hashes. And this does not stop
   a bad actor: an org can pay a second wallet it controls. It makes every claim permanent and
   attributable."
6. **(10s) Close.** "Every donation, in plain sight."

Say before a judge does: *all five wallets are mine for the demo; the point is the mechanism.*

## Likely judge questions
- **"Couldn't the org just confirm its own payouts?"** The program blocks the authority as a
  beneficiary, but a second wallet gets around that. We say so. What it cannot do is hide that those
  wallets are the ones vouching; a donor can ask who received the money. Identity binding is the next layer.
- **"Why not a database?"** The score has to be something the org cannot edit and anyone can recompute.
  `verify.mjs` does that without our server.
- **"Why Solana?"** Cheap enough that a recipient confirming a payout costs a fraction of a cent, which
  is the whole mechanism. On a high-fee chain the people being paid could not afford to answer.
- **"What if the recipient has no wallet?"** A school, clinic or vendor does; guardians can use a
  field worker's device. A sponsored-fee flow is the next step.
- **"What stops donors losing money to a dead org?"** Campaigns have deadlines (max one year); after
  the deadline or a close, payouts freeze and donors reclaim their unspent share.
