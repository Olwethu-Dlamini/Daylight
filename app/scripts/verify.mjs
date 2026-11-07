// Recompute an organisation's delivery score from raw on-chain accounts,
// without the Daylight website. Usage:
//   node scripts/verify.mjs <rpc-url> <org-wallet> [path/to/idl.json]
// Exit code 1 when the org account disagrees with the raw payouts.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  compareWithCounters,
  computeScorecard,
  lamportsToSol,
  percent,
} from "../src/lib/scorecard.ts";

const big = (n) => BigInt(n.toString());
const variant = (e) => Object.keys(e)[0];

// Read through Program, exactly like the web app does, so account fields come
// back camelCase and enum variants lowercase. The raw BorshAccountsCoder
// returns snake_case and PascalCase instead, which would mis-score every payout.
function readOnlyProgram(connection, idl) {
  const wallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: () => Promise.reject(new Error("read-only")),
    signAllTransactions: () => Promise.reject(new Error("read-only")),
  };
  return new Program(idl, new AnchorProvider(connection, wallet, { commitment: "confirmed" }));
}

/** Core: takes any object with the Connection read methods Anchor uses. */
export async function verifyOrg({ connection, idl, authority }) {
  const program = readOnlyProgram(connection, idl);
  const [orgAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("org"), authority.toBuffer()],
    program.programId,
  );

  const org = await program.account.orgProfile.fetchNullable(orgAddress);
  if (!org) throw new Error(`No organisation for wallet ${authority.toBase58()}`);

  const campaigns = await program.account.campaign.all([
    { memcmp: { offset: 8, bytes: orgAddress.toBase58() } },
  ]);
  const campaignKeys = new Set(campaigns.map((c) => c.publicKey.toBase58()));

  const payouts = (await program.account.disbursement.all())
    .filter((r) => campaignKeys.has(r.account.campaign.toBase58()))
    .map((r) => ({
      address: r.publicKey,
      beneficiary: r.account.beneficiary,
      amount: big(r.account.amount),
      status: variant(r.account.status),
    }));

  const card = computeScorecard(payouts);
  const problems = compareWithCounters(card, {
    disbursedCount: org.disbursedCount,
    confirmedCount: org.confirmedCount,
    disputedCount: org.disputedCount,
    disbursedTotal: big(org.disbursedTotal),
    confirmedTotal: big(org.confirmedTotal),
  });

  return { orgAddress, name: org.name, campaigns: campaigns.length, payouts, card, problems };
}

async function main() {
  const [rpc, wallet, idlPath] = process.argv.slice(2);
  if (!rpc || !wallet) {
    console.error("usage: node scripts/verify.mjs <rpc-url> <org-wallet> [idl.json]");
    process.exit(2);
  }
  const idl = JSON.parse(
    readFileSync(idlPath ?? fileURLToPath(new URL("../src/idl/daylight.json", import.meta.url)), "utf8"),
  );
  const r = await verifyOrg({
    connection: new Connection(rpc, "confirmed"),
    idl,
    authority: new PublicKey(wallet),
  });

  console.log(`${r.name}  (org account ${r.orgAddress.toBase58()})`);
  console.log(`${r.campaigns} campaign(s), ${r.card.disbursed} payout(s) found on-chain\n`);
  for (const p of r.payouts) {
    console.log(
      `  ${p.status.padEnd(9)} ${lamportsToSol(p.amount).padStart(10)} SOL  to ${p.beneficiary.toBase58()}`,
    );
  }
  console.log(
    `\nconfirmed ${r.card.confirmed}  disputed ${r.card.disputed}  awaiting ${r.card.pending}` +
      `  ->  ${percent(r.card.confirmedRate)} confirmed`,
  );
  if (r.problems.length) {
    console.log("\nMISMATCH between raw payouts and the org account:");
    for (const p of r.problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nOK: the org account matches the raw payouts.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(2);
  });
}
