import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useApp } from "../app-context.ts";
import {
  CATEGORIES,
  closeCampaign,
  createCampaign,
  disburse,
  getOrg,
  initOrg,
  listCampaigns,
  listDisbursements,
  orgPda,
  type CampaignView,
  type CategoryName,
  type OrgView,
} from "../lib/client.ts";
import { useLoad } from "../lib/useLoad.ts";
import { computeScorecard, lamportsToSol, solToLamports } from "../lib/scorecard.ts";
import { ScoreCard } from "../components/ScoreCard.tsx";
import { HashInput } from "../components/HashInput.tsx";
import { ZERO_HASH } from "../lib/hash.ts";

export function Dashboard() {
  const { program, me, version, go } = useApp();
  const { data, error, loading } = useLoad(async () => {
    if (!me) return null;
    const org = await getOrg(program, orgPda(program.programId, me));
    if (!org) return { org: null };
    const campaigns = await listCampaigns(program, org.address);
    const disbursements = await listDisbursements(program, campaigns.map((c) => c.address));
    return { org, campaigns, disbursements };
  }, [me?.toBase58(), version]);

  if (!me) return <p className="card">Connect a wallet to run an organisation.</p>;
  if (error && !data) return <p className="card warn">{error}</p>;
  if (loading && !data) return <p className="muted">Reading the chain…</p>;
  if (!data?.org) return <CreateOrg />;

  const { org, campaigns = [], disbursements = [] } = data as {
    org: OrgView;
    campaigns?: CampaignView[];
    disbursements?: Awaited<ReturnType<typeof listDisbursements>>;
  };
  const card = computeScorecard(disbursements.map((d) => ({ amount: d.amount, status: d.status })));

  return (
    <>
      <div className="row">
        <h1>{org.name}</h1>
        <button className="btn ghost" onClick={() => go(`#/org/${org.address.toBase58()}`)}>View public page</button>
      </div>
      <ScoreCard card={card} />
      <NewCampaign org={org} />
      <h2>Your campaigns</h2>
      {campaigns.length === 0 && <p className="muted">No campaigns yet.</p>}
      {campaigns.map((c) => <CampaignAdmin key={c.address.toBase58()} c={c} />)}
    </>
  );
}

function CreateOrg() {
  const { program, me, run } = useApp();
  const [name, setName] = useState("");
  return (
    <>
      <h1>Create your organisation</h1>
      <p className="lede">
        One organisation per wallet. Its delivery score will be written by the people you pay,
        never by you.
      </p>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (me && name.trim()) run("Creating organisation", () => initOrg(program, me, name.trim()));
        }}
      >
        <label>
          Organisation name (max 32 bytes)
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
        </label>
        <button className="btn" disabled={!name.trim()}>Create organisation</button>
      </form>
    </>
  );
}

function NewCampaign({ org }: { org: OrgView }) {
  const { program, me, run } = useApp();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CategoryName>("education");
  const [target, setTarget] = useState("1");
  const [days, setDays] = useState("30");
  const [hash, setHash] = useState<number[] | null>(null);

  const targetL = solToLamports(target);
  const d = Number(days);
  const valid = title.trim() && targetL && targetL > 0n && d >= 1 && d <= 365;

  return (
    <>
      <h2>New campaign</h2>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!me || !valid || !targetL) return;
          run("Creating campaign", () =>
            createCampaign(program, me, org, {
              title: title.trim(),
              category,
              metadataHash: hash ?? ZERO_HASH,
              target: targetL,
              deadline: Math.floor(Date.now() / 1000) + d * 86400,
            }),
          );
        }}
      >
        <label>Title (max 64 bytes)<input value={title} maxLength={64} onChange={(e) => setTitle(e.target.value)} placeholder="Term 2 school fees" /></label>
        <div className="row">
          <label style={{ flex: 1 }}>Category
            <select value={category} onChange={(e) => setCategory(e.target.value as CategoryName)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ flex: 1 }}>Target (SOL)<input value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          <label style={{ flex: 1 }}>Runs for (days, 1-365)<input value={days} onChange={(e) => setDays(e.target.value)} /></label>
        </div>
        <HashInput label="Description (kept off-chain, only its hash is stored)" hint="Describe the campaign. No names, photos or ages of children." onHash={setHash} />
        <button className="btn" disabled={!valid}>Create campaign</button>
      </form>
    </>
  );
}

function CampaignAdmin({ c }: { c: CampaignView }) {
  const { program, me, run } = useApp();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [proof, setProof] = useState<number[] | null>(null);

  let beneficiary: PublicKey | null = null;
  try { beneficiary = to ? new PublicKey(to) : null; } catch { beneficiary = null; }
  const lamports = solToLamports(amount);
  const unspent = c.raised - c.disbursed - c.refunded;
  const expired = Math.floor(Date.now() / 1000) > c.deadline;
  const open = c.status === "open" && !expired;

  return (
    <div className="card">
      <div className="row">
        <b>{c.title}</b>
        <span className="pill sent">{c.status === "closed" ? "closed" : expired ? "ended" : "open"}</span>
      </div>
      <div className="stats" style={{ margin: "8px 0" }}>
        <span><b>{lamportsToSol(c.raised)} SOL</b>raised</span>
        <span><b>{lamportsToSol(c.disbursed)} SOL</b>paid out</span>
        <span><b>{lamportsToSol(unspent)} SOL</b>in the vault</span>
      </div>

      {open && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (me && beneficiary && lamports && lamports > 0n)
              run("Paying out", () => disburse(program, me, c, beneficiary!, lamports, proof ?? ZERO_HASH));
          }}
        >
          <label>
            Recipient wallet (guardian, school or vendor, never a child)
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="wallet address" />
          </label>
          <label>Amount (SOL)<input value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <HashInput label="Proof of purchase or delivery (hashed in your browser)" hint="Receipt text, or choose a photo of the receipt" onHash={setProof} />
          <div className="row">
            <button className="btn" disabled={!beneficiary || !lamports || lamports === 0n || lamports > unspent}>Pay out</button>
            <button type="button" className="btn danger" onClick={() => run("Closing campaign", () => closeCampaign(program, me!, c))}>
              Close campaign
            </button>
          </div>
          {to && !beneficiary && <span className="muted">That is not a valid wallet address.</span>}
        </form>
      )}
      {!open && <p className="muted">Payouts are frozen. Donors can now claim their unspent share.</p>}
    </div>
  );
}
