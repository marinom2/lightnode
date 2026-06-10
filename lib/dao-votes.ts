/**
 * Pure aggregation of governor VoteCast + DelegateVotesChanged events into a
 * "who actually decides" view: a voter participation leaderboard and a delegate
 * voting-power leaderboard. No network, so it unit-tests directly.
 *
 * OZ support encoding: 0 = Against, 1 = For, 2 = Abstain.
 */
export interface VoteEvent {
  voter: string;
  support: number;
  weightWei: bigint;
}
export interface DelegateEvent {
  delegate: string;
  newVotesWei: bigint;
}

export interface VoterRow {
  voter: string;
  votes: number;
  forVotes: number;
  against: number;
  abstain: number;
  lastWeightWei: bigint;
}

export function aggregateVoters(events: VoteEvent[]): { rows: VoterRow[]; uniqueVoters: number; totalVotes: number } {
  const byVoter = new Map<string, VoterRow>();
  for (const e of events) {
    const key = e.voter.toLowerCase();
    const row = byVoter.get(key) ?? { voter: e.voter, votes: 0, forVotes: 0, against: 0, abstain: 0, lastWeightWei: 0n };
    row.votes += 1;
    if (e.support === 1) row.forVotes += 1;
    else if (e.support === 0) row.against += 1;
    else if (e.support === 2) row.abstain += 1;
    // Events arrive chronologically, so the last seen weight is the most recent.
    row.lastWeightWei = e.weightWei;
    byVoter.set(key, row);
  }
  const rows = [...byVoter.values()].sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return b.lastWeightWei > a.lastWeightWei ? 1 : b.lastWeightWei < a.lastWeightWei ? -1 : 0;
  });
  return { rows, uniqueVoters: byVoter.size, totalVotes: events.length };
}

export interface DelegateRow {
  delegate: string;
  weightWei: bigint;
}

/** Latest cumulative voting weight per delegate (events must be chronological). */
export function latestDelegateWeights(events: DelegateEvent[]): DelegateRow[] {
  // Dedup case-insensitively but keep the original-cased address for display.
  const latest = new Map<string, DelegateRow>();
  for (const e of events) latest.set(e.delegate.toLowerCase(), { delegate: e.delegate, weightWei: e.newVotesWei });
  return [...latest.values()]
    .filter((d) => d.weightWei > 0n)
    .sort((a, b) => (b.weightWei > a.weightWei ? 1 : b.weightWei < a.weightWei ? -1 : 0));
}

/** Share of total delegated weight held by the top N delegates (0..100). */
export function concentrationPct(rows: DelegateRow[], topN: number): number {
  const total = rows.reduce((sum, r) => sum + r.weightWei, 0n);
  if (total === 0n) return 0;
  const top = rows.slice(0, topN).reduce((sum, r) => sum + r.weightWei, 0n);
  return Math.round(Number((top * 10_000n) / total) / 100);
}
