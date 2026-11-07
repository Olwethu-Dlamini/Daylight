import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareWithCounters,
  computeScorecard,
  lamportsToSol,
  percent,
  solToLamports,
  standing,
  type DisbursementLite,
} from "./scorecard.ts";

const sol = (n: string) => solToLamports(n)!;

// The demo case: one org, three beneficiaries, two confirm and one disputes.
const demo: DisbursementLite[] = [
  { amount: sol("0.5"), status: "confirmed" },
  { amount: sol("0.25"), status: "confirmed" },
  { amount: sol("0.25"), status: "disputed" },
];

test("demo case scores 2 of 3 with 1 disputed", () => {
  const card = computeScorecard(demo);
  assert.equal(card.disbursed, 3);
  assert.equal(card.confirmed, 2);
  assert.equal(card.disputed, 1);
  assert.equal(card.pending, 0);
  assert.equal(percent(card.confirmedRate), "67%");
  assert.equal(card.confirmedTotal, sol("0.75"));
  assert.equal(card.disbursedTotal, sol("1"));
  assert.equal(card.amountRate, 0.75);
});

test("unanswered payouts count as pending, not confirmed", () => {
  const card = computeScorecard([
    { amount: sol("1"), status: "sent" },
    { amount: sol("1"), status: "confirmed" },
  ]);
  assert.equal(card.pending, 1);
  assert.equal(card.confirmed, 1);
  assert.equal(card.confirmedRate, 0.5);
});

test("an org with no payouts has no rate and no history", () => {
  const card = computeScorecard([]);
  assert.equal(card.confirmedRate, null);
  assert.equal(card.amountRate, null);
  assert.equal(percent(card.confirmedRate), "n/a");
  assert.equal(standing(card), "no-history");
});

test("standing thresholds", () => {
  const mk = (confirmed: number, total: number) =>
    computeScorecard(
      Array.from({ length: total }, (_, i) => ({
        amount: 1n,
        status: i < confirmed ? ("confirmed" as const) : ("disputed" as const),
      })),
    );
  assert.equal(standing(mk(9, 10)), "strong");
  assert.equal(standing(mk(6, 10)), "mixed");
  assert.equal(standing(mk(5, 10)), "poor");
});

test("compareWithCounters is empty when org counters match raw accounts", () => {
  const card = computeScorecard(demo);
  const problems = compareWithCounters(card, {
    disbursedCount: 3,
    confirmedCount: 2,
    disputedCount: 1,
    disbursedTotal: sol("1"),
    confirmedTotal: sol("0.75"),
  });
  assert.deepEqual(problems, []);
});

test("compareWithCounters flags an org account that was inflated", () => {
  const card = computeScorecard(demo);
  const problems = compareWithCounters(card, {
    disbursedCount: 3,
    confirmedCount: 3, // org claims a confirmation that never happened
    disputedCount: 0,
    disbursedTotal: sol("1"),
    confirmedTotal: sol("1"),
  });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /confirmed count/);
});

test("lamports and SOL convert exactly", () => {
  assert.equal(lamportsToSol(1_500_000_000n), "1.5");
  assert.equal(lamportsToSol(1n), "0.000000001");
  assert.equal(lamportsToSol(2_000_000_000n), "2");
  assert.equal(solToLamports("0.001"), 1_000_000n);
  assert.equal(solToLamports("1"), 1_000_000_000n);
  assert.equal(solToLamports("abc"), null);
  assert.equal(solToLamports("1.0000000001"), null);
  assert.equal(solToLamports("-1"), null);
});
