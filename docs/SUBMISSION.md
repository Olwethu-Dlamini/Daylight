# Daylight: submission draft

Fill the `TODO` lines, then paste each section into the submission form.

## Name

Daylight

## One-line pitch

Donations to children's aid where the delivery score is written by the people who received the money, not by the organisation.

## Inspiration / the problem

Every aid system has one weak point: the payer is the only author of the story. The org says "we delivered" and nobody else gets a signature.

## What it does

1. Donors send SOL into a campaign vault. The program holds it; the org can only pay out from it.
2. The organisation pays a guardian, school or vendor wallet from the vault, attaching the sha256 of its receipt.
3. The recipient confirms or disputes that payout. Only their wallet can. This is the only way the org's score changes.

The score (confirmed / paid out) is recomputed from the raw on-chain accounts, and `npm run verify` lets anyone check an org without trusting the website. Leftovers after a partial payout are refunded pro-rata to donors once a campaign ends or closes.

No child's name, photo or age is on-chain. Only hashes of off-chain documents are stored.

## How it is built

- Anchor 0.31 program on Solana devnet: PDAs for org, campaign, vault, donation and disbursement; `invoke_signed` vault transfers; rent-exempt checks; pro-rata refunds in u128.
- Program ID: `7abs7aHfEvbAHfgzBouGnrRFsHMcXY66jnEV4ABogeKR`
- 21 tests against the deployed program, including attack cases (wrong signer, payout to self, over-withdrawal, refund before deadline).
- React + Vite + TypeScript front end with Phantom; scorecard logic shared with the verify script and unit-tested.
- Built and deployed entirely in Solana Playground, because of limited data for a local toolchain.

## Proof it works

An end-to-end run with real Phantom wallets on devnet: org created, campaign created, donation, payout, recipient confirmation. `npm run verify` then reports 100% confirmed and that the org counters match the raw accounts. Details are in the README under "Verified on devnet".

## Honest limitations

- An org can pay a second wallet it controls and confirm from it. Daylight makes that a permanent public claim; it does not prove identity.
- It cannot verify the work itself, only what recipients vouch for.
- Payout comes before confirmation, so the score exposes bad actors over time and does not prevent them.
- A new org wallet starts clean, so reputation can be abandoned.
- Devnet only. The hosted front end is a trust gap, which is why the verify script exists.

## What's next

Recipient attestations from trusted community bodies (schools, clinics), a minimum donation, mainnet after an audit.

## Links

- Code: https://github.com/Olwethu-Dlamini/Daylight
- Demo video: TODO
- Live app: TODO (runs locally at http://localhost:5173 today)

## Before you submit

- [ ] TODO: record the demo (see `docs/DEMO.md`)
- [ ] TODO: add the dispute run so the demo score is 2 of 3 (67%)
- [ ] TODO: confirm the track and the submission form's required fields
