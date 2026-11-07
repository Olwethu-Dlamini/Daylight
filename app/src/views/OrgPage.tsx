import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useApp } from "../app-context.ts";
import {
  donate,
  getOrg,
  listCampaigns,
  listDisbursements,
  listDonationsBy,
  refund,
  type CampaignView,
  type DonationView,
} from "../lib/client.ts";
import { useLoad } from "../lib/useLoad.ts";
import { addressUrl, short } from "../lib/explorer.ts";
import {
  compareWithCounters,
  computeScorecard,
  lamportsToSol,
  solToLamports,
} from "../lib/scorecard.ts";
import { ScoreCard } from "../components/ScoreCard.tsx";

const now = () => Math.floor(Date.now() / 1000);
const ended = (c: CampaignView) => c.status === "closed" || now() > c.deadline;

export function OrgPage({ address }: { address: string }) {
  const { program, me, version } = useApp();
  const orgKey = new PublicKey(address);

  const { data, error, loading } = useLoad(async () => {
    const org = await getOrg(program, orgKey);
    if (!org) return null;
    const campaigns = await listCampaigns(program, orgKey);
    const disbursements = await listDisbursements(
      program,
      campaigns.map((c) => c.address),
    );
    const myDonations = me ? await listDonationsBy(program, me) : [];
    return { org, campaigns, disbursements, myDonations };
  }, [address, version, me?.toBase58()]);

  if (error && !data) return <p className="card warn">{error}</p>;
  if (loading && !data) return <p className="muted">Reading the chain…</p>;
  if (!data) return <p className="card">No organisation at this address.</p>;

  const { org, campaigns, disbursements, myDonations } = data;
  const card = computeScorecard(disbursements.map((d) => ({ amount: d.amount, status: d.status })));
  const problems = compareWithCounters(card, org.counters);

  return (
    <>
      <h1>{org.name}</h1>
      <p className="lede">
        Organisation account <a href={addressUrl(org.address)} target="_blank" rel="noreferrer" className="mono">{short(org.address)}</a>.
        This score is recomputed from raw payout accounts on every load. The org cannot edit it:
        only the person who received each payout can confirm or dispute it.
      </p>

      <ScoreCard card={card} />
      {problems.length > 0 && (
        <div className="card warn">
          <b>The org account disagrees with the raw payouts.</b>
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <h2>Campaigns</h2>
      {campaigns.length === 0 && <p className="muted">No campaigns yet.</p>}
      {campaigns.map((c) => (
        <CampaignCard key={c.address.toBase58()} c={c} donations={myDonations.filter((d) => d.campaign.equals(c.address))} />
      ))}

      <h2>Payouts</h2>
      {disbursements.length === 0 ? (
        <p className="muted">Nothing has been paid out yet.</p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr><th>When</th><th>Campaign</th><th>Recipient</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {disbursements.map((d) => {
                const camp = campaigns.find((c) => c.address.equals(d.campaign));
                return (
                  <tr key={d.address.toBase58()}>
                    <td>{new Date(d.sentAt * 1000).toLocaleDateString()}</td>
                    <td>{camp?.title ?? short(d.campaign)}</td>
                    <td>
                      <a className="mono" href={addressUrl(d.beneficiary)} target="_blank" rel="noreferrer">{short(d.beneficiary)}</a>
                    </td>
                    <td>{lamportsToSol(d.amount)} SOL</td>
                    <td>
                      <span className={`pill ${d.status}`}>{d.status === "sent" ? "awaiting reply" : d.status}</span>{" "}
                      <a className="muted" href={addressUrl(d.address)} target="_blank" rel="noreferrer">account</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CampaignCard({ c, donations }: { c: CampaignView; donations: DonationView[] }) {
  const { program, me, run } = useApp();
  const [amount, setAmount] = useState("0.01");
  const pct = c.target === 0n ? 0 : Math.min(100, Number((c.raised * 100n) / c.target));
  const isEnded = ended(c);
  const lamports = solToLamports(amount);
  const refundable = donations.filter((d) => !d.refunded);

  return (
    <div className="card">
      <div className="row">
        <b>{c.title}</b>
        <span className="pill sent">{c.category}</span>
      </div>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
      <div className="stats">
        <span><b>{lamportsToSol(c.raised)} SOL</b>raised of {lamportsToSol(c.target)}</span>
        <span><b>{lamportsToSol(c.disbursed)} SOL</b>paid out</span>
        <span>
          <b>{c.status === "closed" ? "Closed" : isEnded ? "Ended" : "Open"}</b>
          until {new Date(c.deadline * 1000).toLocaleDateString()}
        </span>
      </div>

      {!isEnded && me && (
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (lamports && lamports > 0n) run("Donating", () => donate(program, me, c, lamports));
          }}
        >
          <input style={{ maxWidth: 140 }} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in SOL" />
          <button className="btn" disabled={!lamports || lamports === 0n}>Donate SOL</button>
        </form>
      )}
      {!isEnded && !me && <p className="muted">Connect a wallet to donate.</p>}

      {isEnded && refundable.length > 0 && me && (
        <div style={{ marginTop: 12 }}>
          <p className="muted">
            This campaign has ended. Your unspent share is refundable (pro-rata of what was not paid out).
          </p>
          {refundable.map((d) => (
            <button key={d.address.toBase58()} className="btn ghost" onClick={() => run("Refunding", () => refund(program, me, d))}>
              Refund my {lamportsToSol(d.amount)} SOL donation
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
