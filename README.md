# Daylight

**Every donation, in plain sight.** A children's-aid transparency layer on Solana where an
organisation's delivery score is written by the people it pays, not by the organisation.

## The problem

Every aid system has one author of the truth: the payer. The org says "we delivered" and nobody
else signs. Daylight adds the second signature.

## How it works

1. **Donors** send SOL into a campaign vault (a program-owned PDA). The org cannot withdraw it.
2. **The org** pays a guardian, school or vendor out of that vault, attaching the sha256 of its receipt.
3. **The recipient** confirms or disputes the payout with their own wallet. That is the *only*
   instruction that changes the org's confirmed or disputed counters.

The score (`confirmed / paid out`) is public, permanent, and recomputable by anyone with an RPC
endpoint. See `npm run verify` below.

**Privacy:** no child's name, photo or age is ever on-chain. Recipients are guardian, school or
vendor wallets. Descriptions and proofs stay off-chain; only hashes are stored.

## What is in the repo

| Path | What |
|---|---|
| `programs/daylight/src/lib.rs` | Anchor program: 7 instructions, 4 account types, events, errors |
| `tests/daylight.test.ts` | On-chain tests (run in Solana Playground), including the attack cases |
| `app/` | Vite + React web app: explore orgs, org dashboard, donate, recipient inbox |
| `app/scripts/verify.mjs` | Recompute a score from raw accounts with no help from the website |
| `docs/PLAYGROUND.md` | Build, test and deploy with no local toolchain |
| `docs/DEMO.md` | Demo script, pre-flight checklist, judge Q&A |

### Instructions

`init_org`, `create_campaign`, `donate`, `disburse`, `respond_receipt`, `close_campaign`, `refund`.

### Accounts

`OrgProfile` (counters), `Campaign` (+ vault PDA), `Donation` (one receipt per donation),
`Disbursement` (one per payout, with status Sent, Confirmed or Disputed).

## Run it

Build and deploy the program first: **docs/PLAYGROUND.md**. Then:

```
cd app
npm install
cp .env.example .env        # use your own devnet RPC key
npm run dev                 # app
npm test                    # unit tests (scorecard logic, verify script)
npm run build               # typecheck + production build
npm run verify -- <rpc-url> <org-wallet>
```

## Verified on devnet

Program `7abs7aHfEvbAHfgzBouGnrRFsHMcXY66jnEV4ABogeKR` is deployed on devnet and the
21 tests in `tests/daylight.test.ts` pass against it, including the attack cases.

The web app was also run end to end with real Phantom wallets:

1. One wallet created the org `Daylight Demo Org` (account `8AStXHNNnh83GxSBqhVuTs5qSb4y6Q5diGvTw9HuJ6JL`) and a campaign.
2. SOL was donated into the campaign vault.
3. The org paid 0.01 SOL out of the vault to a second wallet.
4. That second wallet confirmed the payout. Only it could.

Recomputing the score from the raw accounts, with no help from the website:

```
$ npm run verify -- <rpc-url> 4AjM68Fra73HghzVG7rSMJr5kp8KaiRYWgQxUQXHrYY5
Daylight Demo Org  (org account 8AStXHNNnh83GxSBqhVuTs5qSb4y6Q5diGvTw9HuJ6JL)
1 campaign(s), 1 payout(s) found on-chain

  confirmed       0.01 SOL  to GAjY6fYodgKb95JiaBasKfRaoqrEXtqYYCaKjuJw8r9X

confirmed 1  disputed 0  awaiting 0  ->  100% confirmed

OK: the org account matches the raw payouts.
```

This is one payout between wallets the same person controlled, a check that the
mechanism works. It says nothing about a real organisation's honesty (see below).

## Honest limitations

- **It cannot tell a real recipient from the org's own second wallet.** A dishonest org can pay a
  wallet it controls and confirm from it. Daylight makes every payout permanent and attributable;
  it does not prove identity.
- **It cannot verify the work.** A blockchain does not watch the meal being served.
- **Payout comes first, confirmation after.** Collusion is exposed over time, not prevented.
- **Reputation can be abandoned:** a new org wallet starts clean.
- **Devnet only.** The website is a hosted frontend, which is exactly why `verify.mjs` exists.
- Leftover funds after a partial payout are refunded to donors pro-rata once the campaign ends or
  is closed; disbursements are frozen at that point.
- Not audited. Reviewed by hand and by an independent pass; do not put real money in it.
