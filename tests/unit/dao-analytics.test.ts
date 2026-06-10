import { describe, it, expect } from "vitest";
import { computeOutcomeStats, type ProposalOutcome } from "../../lib/dao-analytics";

const e = (n: number) => BigInt(n) * 10n ** 18n;

function p(stateLabel: string, forV = 0, abV = 0, quorum = 0): ProposalOutcome {
  return { stateLabel, votesForWei: e(forV), votesAbstainWei: e(abV), quorumWei: e(quorum) };
}

describe("computeOutcomeStats", () => {
  it("counts proposals by state (case-insensitive)", () => {
    const s = computeOutcomeStats([p("Executed"), p("executed"), p("Defeated"), p("Active")]);
    expect(s.total).toBe(4);
    expect(s.byState.executed).toBe(2);
    expect(s.byState.defeated).toBe(1);
    expect(s.byState.active).toBe(1);
  });

  it("computes pass rate over DECIDED proposals only (active/pending excluded)", () => {
    // 3 passed (executed, succeeded, queued), 1 defeated -> 4 decided; active not decided.
    const s = computeOutcomeStats([p("executed"), p("succeeded"), p("queued"), p("defeated"), p("active")]);
    expect(s.decided).toBe(4);
    expect(s.passed).toBe(3);
    expect(s.passRatePct).toBe(75);
  });

  it("counts For + Abstain toward quorum, excluding Against", () => {
    // forced quorum 300: this one has 200 For + 150 Abstain = 350 >= 300 -> reached.
    const reached = computeOutcomeStats([p("executed", 200, 150, 300)]);
    expect(reached.quorumChecked).toBe(1);
    expect(reached.quorumReached).toBe(1);
    expect(reached.quorumHitRatePct).toBe(100);
  });

  it("marks quorum not reached when For+Abstain falls short", () => {
    const s = computeOutcomeStats([p("defeated", 100, 50, 300)]); // 150 < 300
    expect(s.quorumReached).toBe(0);
    expect(s.quorumHitRatePct).toBe(0);
  });

  it("excludes unknown-quorum proposals (quorumWei 0) from the hit rate", () => {
    const s = computeOutcomeStats([p("executed", 500, 0, 0), p("executed", 500, 0, 300)]);
    expect(s.quorumChecked).toBe(1); // only the one with a known quorum
    expect(s.quorumReached).toBe(1);
    expect(s.quorumHitRatePct).toBe(100);
  });

  it("returns zeroed rates with no decided/checked proposals", () => {
    const s = computeOutcomeStats([p("active"), p("pending")]);
    expect(s.passRatePct).toBe(0);
    expect(s.quorumHitRatePct).toBe(0);
    expect(s.decided).toBe(0);
  });

  it("handles an empty set", () => {
    const s = computeOutcomeStats([]);
    expect(s).toMatchObject({ total: 0, decided: 0, passed: 0, passRatePct: 0, quorumHitRatePct: 0 });
  });
});
