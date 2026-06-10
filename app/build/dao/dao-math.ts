/**
 * Pure governance math for the DAO panel - no network, no React, so it can be
 * unit-tested directly. Quorum follows OZ GovernorCountingSimple (For + Abstain
 * count toward quorum, Against excluded); delegation gap is balance vs active
 * voting power.
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface QuorumStatus {
  /** Quorum requirement in vote-token wei at the proposal snapshot. */
  quorumWei: bigint;
  /** Votes counting toward quorum: For + Abstain. */
  progressWei: bigint;
  /** Remaining wei needed to reach quorum (0 once met). */
  distanceWei: bigint;
  /** progress >= quorum, and quorum is known. */
  met: boolean;
  /** Whether a real quorum value was available (snapshot read succeeded). */
  known: boolean;
  /** Progress toward quorum as a 0..100 percentage. */
  pct: number;
}

export function quorumStatus(votesForWei: bigint, votesAbstainWei: bigint, quorumWei: bigint): QuorumStatus {
  const progressWei = votesForWei + votesAbstainWei;
  const known = quorumWei > 0n;
  const distanceWei = quorumWei > progressWei ? quorumWei - progressWei : 0n;
  const met = known && progressWei >= quorumWei;
  // bigint-first to avoid precision loss on 1e28-scale supplies.
  const pct = known ? Math.min(100, Number((progressWei * 10_000n) / quorumWei) / 100) : 0;
  return { quorumWei, progressWei, distanceWei, met, known, pct };
}

export type DelegationKind = "undelegated" | "self" | "other";

export interface DelegationStatus {
  kind: DelegationKind;
  /** Tokens held that earn no current voting power (balance - votes). */
  gapWei: bigint;
}

export function delegationStatus(
  votesWei: bigint,
  balanceWei: bigint,
  delegate: string,
  account: string,
): DelegationStatus {
  const d = delegate.toLowerCase();
  const kind: DelegationKind =
    d === ZERO_ADDRESS ? "undelegated" : d === account.toLowerCase() ? "self" : "other";
  const gapWei = balanceWei > votesWei ? balanceWei - votesWei : 0n;
  return { kind, gapWei };
}

/** Quorum requirement as a percentage of supply, e.g. numerator 3 / denom 100 -> 3. */
export function quorumPercent(numerator: string, denominator: string): number {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return (n / d) * 100;
}

/** Human duration from seconds: "1 day", "7 days", "12 hours", "30 min". */
export function humanizeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const days = seconds / 86_400;
  if (days >= 1) {
    const rounded = Math.round(days * 10) / 10;
    const label = rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
    return `${label} day${rounded === 1 ? "" : "s"}`;
  }
  const hours = seconds / 3_600;
  if (hours >= 1) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

/** Format a wei amount as a human LCAI/LCAIB string. Display-only (may approximate huge values). */
export function formatLcaiWei(wei: bigint, maxFrac = 0): string {
  const n = Number(wei) / 1e18;
  if (n > 0 && n < 0.0001) return "<0.0001";
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}
