// Pure scoring logic shared by the web app and scripts/verify.mjs.
// Keep this file free of imports and of non-erasable TypeScript so Node can
// run it directly (node strips the types).

export type DisbursementStatus = "sent" | "confirmed" | "disputed";

export interface DisbursementLite {
  amount: bigint;
  status: DisbursementStatus;
}

export interface Scorecard {
  disbursed: number;
  confirmed: number;
  disputed: number;
  pending: number;
  disbursedTotal: bigint;
  confirmedTotal: bigint;
  /** confirmed / disbursed, or null when nothing has been paid out. */
  confirmedRate: number | null;
  /** confirmed lamports / disbursed lamports, or null when nothing was paid. */
  amountRate: number | null;
}

export interface OrgCounters {
  disbursedCount: number;
  confirmedCount: number;
  disputedCount: number;
  disbursedTotal: bigint;
  confirmedTotal: bigint;
}

export type Standing = "no-history" | "strong" | "mixed" | "poor";

export function computeScorecard(disbursements: DisbursementLite[]): Scorecard {
  let confirmed = 0;
  let disputed = 0;
  let pending = 0;
  let disbursedTotal = 0n;
  let confirmedTotal = 0n;

  for (const d of disbursements) {
    disbursedTotal += d.amount;
    if (d.status === "confirmed") {
      confirmed += 1;
      confirmedTotal += d.amount;
    } else if (d.status === "disputed") {
      disputed += 1;
    } else {
      pending += 1;
    }
  }

  const disbursed = disbursements.length;
  return {
    disbursed,
    confirmed,
    disputed,
    pending,
    disbursedTotal,
    confirmedTotal,
    confirmedRate: disbursed === 0 ? null : confirmed / disbursed,
    amountRate:
      disbursedTotal === 0n
        ? null
        : Number((confirmedTotal * 10000n) / disbursedTotal) / 10000,
  };
}

/**
 * Compare a scorecard recomputed from raw disbursement accounts against the
 * counters the program stored on the org. Any line returned is a mismatch.
 */
export function compareWithCounters(card: Scorecard, stored: OrgCounters): string[] {
  const problems: string[] = [];
  const check = (label: string, recomputed: number | bigint, onChain: number | bigint) => {
    if (recomputed !== onChain) {
      problems.push(`${label}: recomputed ${recomputed}, org account says ${onChain}`);
    }
  };
  check("disbursed count", card.disbursed, stored.disbursedCount);
  check("confirmed count", card.confirmed, stored.confirmedCount);
  check("disputed count", card.disputed, stored.disputedCount);
  check("disbursed total", card.disbursedTotal, stored.disbursedTotal);
  check("confirmed total", card.confirmedTotal, stored.confirmedTotal);
  return problems;
}

export function standing(card: Scorecard): Standing {
  if (card.confirmedRate === null) return "no-history";
  if (card.confirmedRate >= 0.9) return "strong";
  if (card.confirmedRate >= 0.6) return "mixed";
  return "poor";
}

export function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Exact lamports to a SOL string without floating point. */
export function lamportsToSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return frac === "" ? `${whole}` : `${whole}.${frac}`;
}

/** Parse a decimal SOL string to lamports; returns null when invalid. */
export function solToLamports(sol: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(sol.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(9, "0");
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt(frac);
}
