import { describe, it, expect } from "vitest";
import { aggregateVoters, latestDelegateWeights, concentrationPct } from "../../lib/dao-votes";

const e = (n: number) => BigInt(n) * 10n ** 18n;
const A = "0xAAaAAa00000000000000000000000000000000aa";
const B = "0xBBbBBb00000000000000000000000000000000bb";
const C = "0xCCcCCc00000000000000000000000000000000cc";

describe("aggregateVoters", () => {
  it("tallies votes per voter and breaks down support (0=against,1=for,2=abstain)", () => {
    const { rows, uniqueVoters, totalVotes } = aggregateVoters([
      { voter: A, support: 1, weightWei: e(100) },
      { voter: A, support: 0, weightWei: e(120) },
      { voter: B, support: 2, weightWei: e(50) },
    ]);
    expect(totalVotes).toBe(3);
    expect(uniqueVoters).toBe(2);
    const a = rows.find((r) => r.voter === A)!;
    expect(a.votes).toBe(2);
    expect(a.forVotes).toBe(1);
    expect(a.against).toBe(1);
    expect(a.lastWeightWei).toBe(e(120)); // most recent weight wins
  });

  it("ranks by participation, then by last weight", () => {
    const { rows } = aggregateVoters([
      { voter: A, support: 1, weightWei: e(10) },
      { voter: B, support: 1, weightWei: e(10) },
      { voter: B, support: 1, weightWei: e(10) },
      { voter: C, support: 1, weightWei: e(999) },
    ]);
    expect(rows[0].voter).toBe(B); // 2 votes
    // A and C both have 1 vote; C has higher weight so ranks above A.
    expect(rows[1].voter).toBe(C);
    expect(rows[2].voter).toBe(A);
  });

  it("is case-insensitive on the voter key", () => {
    const { uniqueVoters } = aggregateVoters([
      { voter: A.toLowerCase(), support: 1, weightWei: e(1) },
      { voter: A.toUpperCase(), support: 1, weightWei: e(1) },
    ]);
    expect(uniqueVoters).toBe(1);
  });
});

describe("latestDelegateWeights", () => {
  it("keeps the latest cumulative weight per delegate and drops zeros", () => {
    const rows = latestDelegateWeights([
      { delegate: A, newVotesWei: e(100) },
      { delegate: A, newVotesWei: e(250) }, // later wins
      { delegate: B, newVotesWei: e(500) },
      { delegate: C, newVotesWei: e(10) },
      { delegate: C, newVotesWei: 0n }, // delegated away -> dropped
    ]);
    expect(rows.map((r) => r.delegate)).toEqual([B, A]); // sorted desc, C excluded
    expect(rows[1].weightWei).toBe(e(250));
  });
});

describe("concentrationPct", () => {
  it("computes the top-N share of total delegated weight", () => {
    const rows = [
      { delegate: A, weightWei: e(60) },
      { delegate: B, weightWei: e(30) },
      { delegate: C, weightWei: e(10) },
    ];
    expect(concentrationPct(rows, 1)).toBe(60);
    expect(concentrationPct(rows, 2)).toBe(90);
  });
  it("returns 0 for an empty set", () => {
    expect(concentrationPct([], 5)).toBe(0);
  });
});
