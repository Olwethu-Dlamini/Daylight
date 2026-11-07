import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl } from "@solana/web3.js";
import type { AnchorWallet } from "./wallet.ts";
import type { DisbursementStatus, OrgCounters } from "./scorecard.ts";

// The IDL comes from the Solana Playground build: save it as src/idl/daylight.json.
const idls = import.meta.glob("../idl/daylight.json", { eager: true, import: "default" }) as Record<
  string,
  Idl
>;
export const IDL: Idl | null = Object.values(idls)[0] ?? null;

export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? clusterApiUrl("devnet");
export const connection = new Connection(RPC_URL, "confirmed");

export type CategoryName = "education" | "food" | "health" | "supplies";
export const CATEGORIES: CategoryName[] = ["education", "food", "health", "supplies"];

// ---------------------------------------------------------------------------
// Views: plain TypeScript objects, so UI code never touches BN or enum shapes
// ---------------------------------------------------------------------------

export interface OrgView {
  address: PublicKey;
  authority: PublicKey;
  name: string;
  campaignCount: number;
  counters: OrgCounters;
  createdAt: number;
}

export interface CampaignView {
  address: PublicKey;
  org: PublicKey;
  id: number;
  title: string;
  category: CategoryName;
  metadataHash: number[];
  target: bigint;
  raised: bigint;
  disbursed: bigint;
  refunded: bigint;
  donationCount: number;
  disbursementCount: number;
  deadline: number;
  status: "open" | "closed";
}

export interface DonationView {
  address: PublicKey;
  campaign: PublicKey;
  donor: PublicKey;
  index: number;
  amount: bigint;
  createdAt: number;
  refunded: boolean;
}

export interface DisbursementView {
  address: PublicKey;
  campaign: PublicKey;
  index: number;
  beneficiary: PublicKey;
  amount: bigint;
  proofHash: number[];
  status: DisbursementStatus;
  sentAt: number;
  respondedAt: number;
}

const big = (n: BN): bigint => BigInt(n.toString());
const variant = (e: object): string => Object.keys(e)[0];

/* eslint-disable @typescript-eslint/no-explicit-any */
const toOrg = (address: PublicKey, a: any): OrgView => ({
  address,
  authority: a.authority,
  name: a.name,
  campaignCount: a.campaignCount,
  createdAt: a.createdAt.toNumber(),
  counters: {
    disbursedCount: a.disbursedCount,
    confirmedCount: a.confirmedCount,
    disputedCount: a.disputedCount,
    disbursedTotal: big(a.disbursedTotal),
    confirmedTotal: big(a.confirmedTotal),
  },
});

const toCampaign = (address: PublicKey, a: any): CampaignView => ({
  address,
  org: a.org,
  id: a.id,
  title: a.title,
  category: variant(a.category) as CategoryName,
  metadataHash: Array.from(a.metadataHash as number[]),
  target: big(a.target),
  raised: big(a.raised),
  disbursed: big(a.disbursed),
  refunded: big(a.refunded),
  donationCount: a.donationCount,
  disbursementCount: a.disbursementCount,
  deadline: a.deadline.toNumber(),
  status: variant(a.status) as "open" | "closed",
});

const toDonation = (address: PublicKey, a: any): DonationView => ({
  address,
  campaign: a.campaign,
  donor: a.donor,
  index: a.index,
  amount: big(a.amount),
  createdAt: a.createdAt.toNumber(),
  refunded: a.refunded,
});

const toDisbursement = (address: PublicKey, a: any): DisbursementView => ({
  address,
  campaign: a.campaign,
  index: a.index,
  beneficiary: a.beneficiary,
  amount: big(a.amount),
  proofHash: Array.from(a.proofHash as number[]),
  status: variant(a.status) as DisbursementStatus,
  sentAt: a.sentAt.toNumber(),
  respondedAt: a.respondedAt.toNumber(),
});

// ---------------------------------------------------------------------------
// Program handle
// ---------------------------------------------------------------------------

const readOnlyWallet: AnchorWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: () => Promise.reject(new Error("Connect a wallet to sign")),
  signAllTransactions: () => Promise.reject(new Error("Connect a wallet to sign")),
};

export function getProgram(wallet?: AnchorWallet | null): Program<Idl> {
  if (!IDL) throw new Error("IDL missing: save the Playground IDL as app/src/idl/daylight.json");
  const provider = new AnchorProvider(connection, wallet ?? readOnlyWallet, {
    commitment: "confirmed",
  });
  return new Program(IDL, provider);
}

// ---------------------------------------------------------------------------
// PDAs (must match the seeds in programs/daylight/src/lib.rs)
// ---------------------------------------------------------------------------

const enc = (s: string) => new TextEncoder().encode(s);
const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const find = (pid: PublicKey, seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];

export const orgPda = (pid: PublicKey, authority: PublicKey) =>
  find(pid, [enc("org"), authority.toBytes()]);
export const campaignPda = (pid: PublicKey, org: PublicKey, id: number) =>
  find(pid, [enc("campaign"), org.toBytes(), u32le(id)]);
export const vaultPda = (pid: PublicKey, campaign: PublicKey) =>
  find(pid, [enc("vault"), campaign.toBytes()]);
export const donationPda = (pid: PublicKey, campaign: PublicKey, index: number) =>
  find(pid, [enc("donation"), campaign.toBytes(), u32le(index)]);
export const disbursementPda = (pid: PublicKey, campaign: PublicKey, index: number) =>
  find(pid, [enc("disb"), campaign.toBytes(), u32le(index)]);

// ---------------------------------------------------------------------------
// Reads. Account layouts (offset after the 8-byte discriminator):
//   Campaign.org @8 | Donation.campaign @8, donor @40 | Disbursement.campaign @8, beneficiary @44
// ---------------------------------------------------------------------------

export async function listOrgs(p: Program<Idl>): Promise<OrgView[]> {
  const rows = await (p.account as any).orgProfile.all();
  return rows.map((r: any) => toOrg(r.publicKey, r.account));
}

export async function getOrg(p: Program<Idl>, address: PublicKey): Promise<OrgView | null> {
  const a = await (p.account as any).orgProfile.fetchNullable(address);
  return a ? toOrg(address, a) : null;
}

export async function listCampaigns(p: Program<Idl>, org: PublicKey): Promise<CampaignView[]> {
  const rows = await (p.account as any).campaign.all([
    { memcmp: { offset: 8, bytes: org.toBase58() } },
  ]);
  return rows.map((r: any) => toCampaign(r.publicKey, r.account)).sort((a: CampaignView, b: CampaignView) => a.id - b.id);
}

export async function getCampaign(p: Program<Idl>, address: PublicKey): Promise<CampaignView | null> {
  const a = await (p.account as any).campaign.fetchNullable(address);
  return a ? toCampaign(address, a) : null;
}

export async function listDisbursements(
  p: Program<Idl>,
  campaigns: PublicKey[],
): Promise<DisbursementView[]> {
  const set = new Set(campaigns.map((c) => c.toBase58()));
  const rows = await (p.account as any).disbursement.all();
  return rows
    .map((r: any) => toDisbursement(r.publicKey, r.account))
    .filter((d: DisbursementView) => set.has(d.campaign.toBase58()))
    .sort((a: DisbursementView, b: DisbursementView) => a.sentAt - b.sentAt);
}

export async function listPayoutsTo(p: Program<Idl>, wallet: PublicKey): Promise<DisbursementView[]> {
  const rows = await (p.account as any).disbursement.all([
    { memcmp: { offset: 44, bytes: wallet.toBase58() } },
  ]);
  return rows.map((r: any) => toDisbursement(r.publicKey, r.account));
}

export async function listDonationsBy(p: Program<Idl>, donor: PublicKey): Promise<DonationView[]> {
  const rows = await (p.account as any).donation.all([
    { memcmp: { offset: 40, bytes: donor.toBase58() } },
  ]);
  return rows.map((r: any) => toDonation(r.publicKey, r.account));
}

// ---------------------------------------------------------------------------
// Writes. Each returns the transaction signature.
// ---------------------------------------------------------------------------

export async function initOrg(p: Program<Idl>, authority: PublicKey, name: string) {
  return p.methods
    .initOrg(name)
    .accounts({
      authority,
      org: orgPda(p.programId, authority),
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
}

export async function createCampaign(
  p: Program<Idl>,
  authority: PublicKey,
  org: OrgView,
  args: {
    title: string;
    category: CategoryName;
    metadataHash: number[];
    target: bigint;
    deadline: number;
  },
) {
  const campaign = campaignPda(p.programId, org.address, org.campaignCount);
  return p.methods
    .createCampaign(
      args.title,
      { [args.category]: {} },
      args.metadataHash,
      new BN(args.target.toString()),
      new BN(args.deadline),
    )
    .accounts({
      authority,
      org: org.address,
      campaign,
      vault: vaultPda(p.programId, campaign),
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
}

export async function donate(p: Program<Idl>, donor: PublicKey, campaign: CampaignView, amount: bigint) {
  // Re-read the counter so the receipt PDA matches the on-chain index.
  const fresh = await getCampaign(p, campaign.address);
  if (!fresh) throw new Error("Campaign not found");
  return p.methods
    .donate(new BN(amount.toString()))
    .accounts({
      donor,
      campaign: campaign.address,
      vault: vaultPda(p.programId, campaign.address),
      donation: donationPda(p.programId, campaign.address, fresh.donationCount),
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
}

export async function disburse(
  p: Program<Idl>,
  authority: PublicKey,
  campaign: CampaignView,
  beneficiary: PublicKey,
  amount: bigint,
  proofHash: number[],
) {
  const fresh = await getCampaign(p, campaign.address);
  if (!fresh) throw new Error("Campaign not found");
  return p.methods
    .disburse(new BN(amount.toString()), proofHash)
    .accounts({
      authority,
      org: orgPda(p.programId, authority),
      campaign: campaign.address,
      vault: vaultPda(p.programId, campaign.address),
      beneficiary,
      disbursement: disbursementPda(p.programId, campaign.address, fresh.disbursementCount),
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
}

export async function respondReceipt(
  p: Program<Idl>,
  beneficiary: PublicKey,
  disbursement: DisbursementView,
  org: PublicKey,
  accepted: boolean,
) {
  return p.methods
    .respondReceipt(accepted)
    .accounts({
      beneficiary,
      org,
      campaign: disbursement.campaign,
      disbursement: disbursement.address,
    } as any)
    .rpc();
}

export async function closeCampaign(p: Program<Idl>, authority: PublicKey, campaign: CampaignView) {
  return p.methods
    .closeCampaign()
    .accounts({
      authority,
      org: orgPda(p.programId, authority),
      campaign: campaign.address,
    } as any)
    .rpc();
}

export async function refund(p: Program<Idl>, donor: PublicKey, donation: DonationView) {
  return p.methods
    .refund()
    .accounts({
      donor,
      campaign: donation.campaign,
      vault: vaultPda(p.programId, donation.campaign),
      donation: donation.address,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
}

/** Turn an Anchor or wallet error into one line a person can read. */
export function explainError(e: unknown): string {
  const err = e as { error?: { errorMessage?: string }; message?: string; logs?: string[] };
  if (err?.error?.errorMessage) return err.error.errorMessage;
  const fromLogs = err?.logs?.find((l) => l.includes("Error Message:"));
  if (fromLogs) return fromLogs.split("Error Message:")[1].trim();
  return err?.message ?? String(e);
}
