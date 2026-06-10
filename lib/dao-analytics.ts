/**
 * Pure aggregation of governance outcomes across every proposal. No network, so
 * it unit-tests directly; the analytics route feeds it the per-proposal reads.
 *
 * OZ GovernorCountingSimple: For + Abstain count toward quorum (Against excluded);
 * a proposal "passed" once it reached Succeeded/Queued/Executed.
 */
export interface ProposalOutcome {
  stateLabel: string;
  votesForWei: bigint;
  votesAbstainWei: bigint;
  quorumWei: bigint; // 0 = unknown (snapshot/quorum read failed)
}

export interface OutcomeStats {
  total: number;
  byState: Record<string, number>;
  decided: number;
  passed: number;
  passRatePct: number;
  quorumChecked: number;
  quorumReached: number;
  quorumHitRatePct: number;
}

const PASSED_STATES = new Set(["succeeded", "queued", "executed"]);
const DECIDED_STATES = new Set(["succeeded", "queued", "executed", "defeated", "expired", "canceled"]);

export function computeOutcomeStats(proposals: ProposalOutcome[]): OutcomeStats {
  const byState: Record<string, number> = {};
  let passed = 0;
  let decided = 0;
  let quorumChecked = 0;
  let quorumReached = 0;

  for (const p of proposals) {
    const label = p.stateLabel.toLowerCase();
    byState[label] = (byState[label] ?? 0) + 1;
    if (DECIDED_STATES.has(label)) decided += 1;
    if (PASSED_STATES.has(label)) passed += 1;
    if (p.quorumWei > 0n) {
      quorumChecked += 1;
      if (p.votesForWei + p.votesAbstainWei >= p.quorumWei) quorumReached += 1;
    }
  }

  return {
    total: proposals.length,
    byState,
    decided,
    passed,
    passRatePct: decided > 0 ? Math.round((passed / decided) * 100) : 0,
    quorumChecked,
    quorumReached,
    quorumHitRatePct: quorumChecked > 0 ? Math.round((quorumReached / quorumChecked) * 100) : 0,
  };
}
