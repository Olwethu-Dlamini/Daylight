# Build and deploy with Solana Playground (no local install)

Everything below happens in the browser at https://beta.solpg.io. Total data use is small.

## 1. Create the project
1. Open https://beta.solpg.io and press **Create a new project**.
2. Name it `daylight`, pick framework **Anchor (Rust)**.
3. In the left file tree, open `src/lib.rs`, select all, delete, and paste the whole of
   `programs/daylight/src/lib.rs` from this repo.
4. Open the **Settings** (gear, bottom left) and make sure the Anchor version is **0.30 or newer**.
   The IDL format and the app both depend on it. If a later step gives you an IDL with no
   `"address"` field, you are on an old version: switch it and rebuild.

## 2. Wallet and devnet SOL
1. Bottom left, press **Not connected** and create a Playground wallet (save the keypair somewhere
   private, never commit it).
2. In the terminal at the bottom, run `solana config set -ud` then `solana airdrop 5`.
   If the airdrop is rate limited, use https://faucet.solana.com with the wallet address.
   A deploy needs roughly 3 to 4 SOL. The tests need about 1 more.

## 3. Build
1. Press **Build** (hammer icon). The first build takes a minute or two.
2. **Paste any compiler error to me verbatim.** I have no compiler here, so this is the first
   time the program is compiled. Expect at most small fixes.

## 4. Test before deploying
1. In the file tree open `tests/`, delete the sample test, and create `daylight.test.ts`.
2. Paste the contents of `tests/daylight.test.ts` from this repo.
3. Press **Test** (beaker icon). Every test should be green. Paste me any red one.

## 5. Deploy
1. Press **Deploy** (rocket icon). Confirm the wallet prompt.
2. Copy the **Program ID** that appears.

## 6. Hand the IDL to the app
1. In the left sidebar open **Build & Deploy**, find **Program credentials** and **IDL**, and press
   **Export IDL** (or copy it).
2. Save the export somewhere (e.g. Downloads). Look at it: if it has **no `"address"` field** it is an
   old-format (Anchor 0.29) IDL, which is what Playground exported for this project. Convert it:
   ```
   cd app
   npm run convert-idl -- ~/Downloads/idl.json <PROGRAM_ID>
   ```
   This writes `app/src/idl/daylight.json` in the new format. The deployed program is unchanged.
   If your export already has `"address"`, just save it as `app/src/idl/daylight.json`.
3. Paste the Program ID into `declare_id!(...)` in `programs/daylight/src/lib.rs` and into
   `Anchor.toml` too, so the repo matches what is deployed.

## 7. Run the app
```
cd app
cp .env.example .env     # put your own RPC key in VITE_RPC_URL (Helius free tier works)
npm run dev
```
Open the printed URL with Phantom installed and switched to **devnet**.
