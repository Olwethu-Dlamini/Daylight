import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BN, BorshAccountsCoder, utils } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { verifyOrg } from "./verify.mjs";

const bs58 = utils.bytes.bs58;

// Test-only IDL, laid out exactly like the structs in programs/daylight/src/lib.rs.
const disc = (name) => Array.from(createHash("sha256").update(`account:${name}`).digest().subarray(0, 8));
const struct = (name, fields) => ({ name, type: { kind: "struct", fields } });
const en = (name, vs) => ({ name, type: { kind: "enum", variants: vs.map((v) => ({ name: v })) } });
const def = (name) => ({ defined: { name } });
const programId = Keypair.generate().publicKey;
const idl = {
  address: programId.toBase58(),
  metadata: { name: "daylight", version: "0.1.0", spec: "0.1.0" },
  instructions: [],
  accounts: ["OrgProfile", "Campaign", "Disbursement"].map((name) => ({ name, discriminator: disc(name) })),
  types: [
    struct("OrgProfile", [
      { name: "authority", type: "pubkey" }, { name: "name", type: "string" },
      { name: "campaign_count", type: "u32" }, { name: "disbursed_count", type: "u32" },
      { name: "confirmed_count", type: "u32" }, { name: "disputed_count", type: "u32" },
      { name: "disbursed_total", type: "u64" }, { name: "confirmed_total", type: "u64" },
      { name: "created_at", type: "i64" },
    ]),
    struct("Campaign", [
      { name: "org", type: "pubkey" }, { name: "id", type: "u32" }, { name: "title", type: "string" },
      { name: "category", type: def("Category") }, { name: "metadata_hash", type: { array: ["u8", 32] } },
      { name: "target", type: "u64" }, { name: "raised", type: "u64" }, { name: "disbursed", type: "u64" },
      { name: "refunded", type: "u64" }, { name: "donation_count", type: "u32" },
      { name: "disbursement_count", type: "u32" }, { name: "deadline", type: "i64" },
      { name: "status", type: def("CampaignStatus") },
    ]),
    struct("Disbursement", [
      { name: "campaign", type: "pubkey" }, { name: "index", type: "u32" },
      { name: "beneficiary", type: "pubkey" }, { name: "amount", type: "u64" },
      { name: "proof_hash", type: { array: ["u8", 32] } }, { name: "status", type: def("DisbursementStatus") },
      { name: "sent_at", type: "i64" }, { name: "responded_at", type: "i64" },
    ]),
    en("Category", ["Education", "Food", "Health", "Supplies"]),
    en("CampaignStatus", ["Open", "Closed"]),
    en("DisbursementStatus", ["Sent", "Confirmed", "Disputed"]),
  ],
};
const coder = new BorshAccountsCoder(idl);
const lam = (n) => new BN(n);

// The raw coder encodes by snake_case field name and silently writes zeros for
// any key it does not recognise, so convert before encoding.
const snake = (o) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()), v]));
const encode = (name, obj) => coder.encode(name, snake(obj));

/** A fake RPC that stores accounts and honours memcmp filters like a real node. */
function fakeRpc() {
  const store = new Map();
  return {
    put: (pk, data) =>
      store.set(pk.toBase58(), {
        pubkey: pk,
        account: { data, executable: false, lamports: 1, owner: programId },
      }),
    rpcEndpoint: "http://fake",
    getAccountInfo: async (pk) => store.get(pk.toBase58())?.account ?? null,
    getAccountInfoAndContext: async (pk) => ({
      context: { slot: 1 },
      value: store.get(pk.toBase58())?.account ?? null,
    }),
    getProgramAccounts: async (_pid, { filters }) =>
      [...store.values()].filter(({ account }) =>
        filters.every(({ memcmp }) => {
          const want = Buffer.from(bs58.decode(memcmp.bytes));
          return account.data.subarray(memcmp.offset, memcmp.offset + want.length).equals(want);
        }),
      ),
  };
}

async function world({ confirmedCountOnOrg } = {}) {
  const rpc = fakeRpc();
  const authority = Keypair.generate().publicKey;
  const [orgAddr] = PublicKey.findProgramAddressSync([Buffer.from("org"), authority.toBuffer()], programId);
  const campaign = Keypair.generate().publicKey;

  rpc.put(orgAddr, await encode("OrgProfile", {
    authority, name: "Test Fund", campaignCount: 1, disbursedCount: 3,
    confirmedCount: confirmedCountOnOrg ?? 2, disputedCount: confirmedCountOnOrg === 3 ? 0 : 1,
    disbursedTotal: lam(1_000_000_000), confirmedTotal: lam(confirmedCountOnOrg === 3 ? 1_000_000_000 : 750_000_000),
    createdAt: lam(0),
  }));
  rpc.put(campaign, await encode("Campaign", {
    org: orgAddr, id: 0, title: "Term 2", category: { Education: {} }, metadataHash: new Array(32).fill(0),
    target: lam(1), raised: lam(1), disbursed: lam(1), refunded: lam(0), donationCount: 1,
    disbursementCount: 3, deadline: lam(1), status: { Open: {} },
  }));
  const statuses = [
    [500_000_000, { Confirmed: {} }], [250_000_000, { Confirmed: {} }], [250_000_000, { Disputed: {} }],
  ];
  for (const [i, [amount, status]] of statuses.entries()) {
    rpc.put(Keypair.generate().publicKey, await encode("Disbursement", {
      campaign, index: i, beneficiary: Keypair.generate().publicKey, amount: lam(amount),
      proofHash: new Array(32).fill(0), status, sentAt: lam(0), respondedAt: lam(0),
    }));
  }

  // A different org's campaign and payout that must NOT be counted.
  const otherOrg = Keypair.generate().publicKey;
  const otherCampaign = Keypair.generate().publicKey;
  rpc.put(otherCampaign, await encode("Campaign", {
    org: otherOrg, id: 0, title: "Other", category: { Food: {} }, metadataHash: new Array(32).fill(0),
    target: lam(1), raised: lam(1), disbursed: lam(1), refunded: lam(0), donationCount: 0,
    disbursementCount: 1, deadline: lam(1), status: { Open: {} },
  }));
  rpc.put(Keypair.generate().publicKey, await encode("Disbursement", {
    campaign: otherCampaign, index: 0, beneficiary: Keypair.generate().publicKey, amount: lam(999),
    proofHash: new Array(32).fill(0), status: { Confirmed: {} }, sentAt: lam(0), respondedAt: lam(0),
  }));
  return { rpc, authority };
}

test("an honest org: raw payouts match the org account", async () => {
  const { rpc, authority } = await world();
  const r = await verifyOrg({ connection: rpc, idl, authority });
  assert.equal(r.name, "Test Fund");
  assert.equal(r.campaigns, 1);
  assert.equal(r.card.disbursed, 3);
  assert.equal(r.card.confirmed, 2);
  assert.equal(r.card.disputed, 1);
  assert.deepEqual(r.problems, []);
});

test("another org's payouts are not counted", async () => {
  const { rpc, authority } = await world();
  const r = await verifyOrg({ connection: rpc, idl, authority });
  assert.equal(r.payouts.length, 3);
  assert.equal(r.card.disbursedTotal, 1_000_000_000n);
});

test("an org account that overstates confirmations is flagged", async () => {
  const { rpc, authority } = await world({ confirmedCountOnOrg: 3 });
  const r = await verifyOrg({ connection: rpc, idl, authority });
  assert.deepEqual(r.problems, [
    "confirmed count: recomputed 2, org account says 3",
    "disputed count: recomputed 1, org account says 0",
    "confirmed total: recomputed 750000000, org account says 1000000000",
  ]);
});

test("a wallet with no organisation is an error, not an empty score", async () => {
  const { rpc } = await world();
  await assert.rejects(
    verifyOrg({ connection: rpc, idl, authority: Keypair.generate().publicKey }),
    /No organisation/,
  );
});
