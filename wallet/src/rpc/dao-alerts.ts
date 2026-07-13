/**
 * Pure logic for governance vote reminders. The background alarm reads the
 * account's open Lightchain AI proposals and turns them into "you can still
 * vote" alerts; the popup shows the same as an in-app banner. Kept side-effect
 * free so it is fully unit-testable.
 */
import type { ProposalView } from "./governance";

export interface VoteAlert {
  id: string;
  title: string;
  blocksLeft: number | null;
}

/**
 * Proposals the account can act on right now: active, not already voted, and
 * carrying voting weight at the snapshot. `youVoted`/`yourWeight` are only
 * populated for active proposals when a voter address was supplied.
 */
export function actionableProposals(proposals: ProposalView[]): VoteAlert[] {
  return proposals
    .filter((p) => p.state === "active" && !p.youVoted && p.yourWeight > 0)
    .map((p) => ({ id: p.id, title: p.title, blocksLeft: p.blocksLeft }));
}

/** Alerts whose proposal id has not been notified about yet. */
export function newAlerts(alerts: VoteAlert[], notifiedIds: string[]): VoteAlert[] {
  const seen = new Set(notifiedIds);
  return alerts.filter((a) => !seen.has(a.id));
}

/** Notification copy for a batch of unvoted-but-open proposals, or null. */
export function voteNotification(alerts: VoteAlert[]): { title: string; message: string } | null {
  if (alerts.length === 0) return null;
  const title = "Lightchain AI governance";
  if (alerts.length === 1) {
    return { title, message: `A vote is open: "${alerts[0]!.title}". Open your wallet to cast it.` };
  }
  return { title, message: `${alerts.length} proposals are open for your vote. Open your wallet to cast them.` };
}
