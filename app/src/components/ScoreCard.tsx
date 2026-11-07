import { lamportsToSol, percent, standing, type Scorecard } from "../lib/scorecard.ts";

const LABEL = {
  strong: "Strong delivery",
  mixed: "Mixed delivery",
  poor: "Poor delivery",
  "no-history": "No payouts yet",
} as const;

export function ScoreCard({ card }: { card: Scorecard }) {
  const s = standing(card);
  const total = Math.max(card.disbursed, 1);
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="card">
      <div className="row">
        <div className="score">
          <span className="big">{percent(card.confirmedRate)}</span>
          <span className="muted">of payouts confirmed by the people who received them</span>
        </div>
        <span className={`pill ${s}`}>{LABEL[s]}</span>
      </div>
      <div className="bar" aria-hidden="true">
        <i className="c" style={{ width: w(card.confirmed) }} />
        <i className="d" style={{ width: w(card.disputed) }} />
        <i className="p" style={{ width: w(card.pending) }} />
      </div>
      <div className="stats">
        <span><b>{card.confirmed}</b>confirmed</span>
        <span><b>{card.disputed}</b>disputed</span>
        <span><b>{card.pending}</b>awaiting reply</span>
        <span><b>{lamportsToSol(card.disbursedTotal)} SOL</b>paid out</span>
        <span><b>{lamportsToSol(card.confirmedTotal)} SOL</b>confirmed</span>
      </div>
    </div>
  );
}
