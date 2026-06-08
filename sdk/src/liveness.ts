/**
 * Worker liveness + stuck-job diagnostic. Read-only and pure: it classifies a
 * worker's recent jobs against the live protocol timeouts to surface the failure
 * mode that is otherwise invisible until the stake is slashed - a registered,
 * staked worker that has quietly gone offline and is no longer acknowledging the
 * jobs the chain assigns it.
 *
 * Two distinct stuck states, both past their on-chain deadline:
 *   - "unacked":     Submitted but never acknowledged, past submitted_at +
 *                    ackTimeoutSec. Realizes the ACK-timeout slash when claimed.
 *   - "incomplete":  Acknowledged but never completed, past ack_at +
 *                    completionTimeoutSec. Realizes the COMPLETION-timeout slash.
 *
 * The "unacked" case is the one the simple job buckets miss (they count a
 * Submitted job as in-flight no matter how old), so an offline worker looks idle
 * rather than at-risk.
 */
import type { Job, Worker } from "./types.js";
import type { WorkerProtocolConfig } from "./worker-operator.js";

export type StuckKind = "unacked" | "incomplete";

export interface StuckJobReport {
  id: string;
  /** "unacked" = Submitted past the ack deadline; "incomplete" = Acknowledged past the completion deadline. */
  kind: StuckKind;
  /** Raw subgraph state string. */
  state: string;
  /** The protocol deadline this job blew through (unix seconds). */
  deadlineAtSec: number;
  /** How long past the deadline it is now (seconds, always > 0 for a stuck job). */
  pastDeadlineSec: number;
  /** Slash basis points this job realizes if it is timed out (ack vs completion). */
  slashBps: number;
}

/**
 * - "fresh":   no stuck jobs and the chain has seen the worker (it is keeping up).
 * - "stalled": at least one assigned job is past its deadline - the worker is not
 *              processing work it was given (offline / disconnected / overloaded).
 * - "unknown": the indexer has never seen this worker (nothing to judge).
 */
export type Liveness = "fresh" | "stalled" | "unknown";

export interface WorkerLivenessReport {
  address: string;
  /** Subgraph status string (active | deactivated | deregistered), or null if unseen. */
  status: string | null;
  liveness: Liveness;
  /** Seconds since the worker's last ON-CHAIN activity (not a heartbeat), or null. */
  lastSeenAgoSec: number | null;
  /** active_job_count from the subgraph (includes the stuck jobs blocking capacity). */
  activeJobCount: number;
  stuckJobs: StuckJobReport[];
  unackedCount: number;
  incompleteCount: number;
  /** Combined slash bps if every stuck job is timed out, capped at the protocol max. */
  slashExposureBps: number;
  /** The same exposure expressed in whole LCAI, from the worker's current stake. */
  slashExposureLcai: number;
  /** The number of timeouts that suspends a worker (from config). */
  suspensionThreshold: number;
  /** True when the stuck-job count would reach the suspension threshold. */
  suspensionRisk: boolean;
  /** One-line human summary. */
  summary: string;
}

/** Config subset the analyzer needs - a full WorkerProtocolConfig satisfies it. */
export type LivenessConfig = Pick<
  WorkerProtocolConfig,
  "ackTimeoutSec" | "completionTimeoutSec" | "slashBps" | "suspensionThreshold"
>;

function stakeWeiOf(worker: Worker | null, override?: bigint): bigint {
  if (override !== undefined) return override;
  if (!worker?.stake) return 0n;
  try {
    return BigInt(worker.stake);
  } catch {
    return 0n;
  }
}

/** Classify one job; null when it is not stuck. */
function classifyJob(job: Job, cfg: LivenessConfig, nowSec: number): StuckJobReport | null {
  const state = (job.state ?? "").toLowerCase();
  if (state.includes("submitted")) {
    if (!job.submitted_at) return null;
    const deadlineAtSec = job.submitted_at + cfg.ackTimeoutSec;
    if (nowSec <= deadlineAtSec) return null; // still inside the ack window
    return { id: job.id, kind: "unacked", state: job.state, deadlineAtSec, pastDeadlineSec: nowSec - deadlineAtSec, slashBps: cfg.slashBps.ackTimeout };
  }
  if (state.includes("ack")) {
    if (!job.ack_at) return null;
    const deadlineAtSec = job.ack_at + cfg.completionTimeoutSec;
    if (nowSec <= deadlineAtSec) return null; // still inside the completion window
    return { id: job.id, kind: "incomplete", state: job.state, deadlineAtSec, pastDeadlineSec: nowSec - deadlineAtSec, slashBps: cfg.slashBps.completionTimeout };
  }
  return null; // completed / released / resolved / timed-out: nothing pending
}

function buildSummary(r: Omit<WorkerLivenessReport, "summary">): string {
  if (r.status === null) return "Worker not found on the indexer yet.";
  if (r.stuckJobs.length === 0) return "No stuck jobs - the worker is keeping up with its assigned work.";
  const parts: string[] = [];
  // Don't assert WHY here - "never acknowledged" can be offline, disconnected, OR
  // out of gas. The caller that knows the wallet balance (the action center)
  // attributes the cause; this stays neutral.
  if (r.unackedCount > 0) parts.push(`${r.unackedCount} assigned but never acknowledged`);
  if (r.incompleteCount > 0) parts.push(`${r.incompleteCount} acknowledged but never completed`);
  const exposure = r.slashExposureLcai > 0 ? `, up to ~${r.slashExposureLcai.toFixed(0)} LCAI at risk if timed out` : "";
  const susp = r.suspensionRisk ? "; reaching the suspension threshold" : "";
  return `${parts.join(", ")}${exposure}${susp}.`;
}

/**
 * Build the liveness report from already-fetched subgraph data + live protocol
 * config. Pure (no I/O); pass `nowSec` to make it deterministic in tests.
 */
export function analyzeWorkerLiveness(input: {
  worker: Worker | null;
  jobs: Job[];
  config: LivenessConfig;
  /** Override the staked amount (wei); defaults to worker.stake. */
  stakeWei?: bigint;
  nowSec?: number;
}): WorkerLivenessReport {
  const { worker, jobs, config } = input;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);

  const stuckJobs = jobs.map((j) => classifyJob(j, config, nowSec)).filter((s): s is StuckJobReport => s !== null);
  const unackedCount = stuckJobs.filter((s) => s.kind === "unacked").length;
  const incompleteCount = stuckJobs.filter((s) => s.kind === "incomplete").length;

  const rawExposureBps = stuckJobs.reduce((sum, s) => sum + s.slashBps, 0);
  const slashExposureBps = Math.min(rawExposureBps, config.slashBps.max);
  const stakeWei = stakeWeiOf(worker, input.stakeWei);
  // Exposure in LCAI: do the bps math in BigInt wei (exact), then scale down via
  // milli-LCAI so a whole-LCAI stake yields an exact figure (Number(largeWei)/1e18
  // loses precision past 2^53). Keeps 3 decimals for fractional stakes.
  const exposureWei = (stakeWei * BigInt(slashExposureBps)) / 10_000n;
  const slashExposureLcai = Number(exposureWei / 10n ** 15n) / 1000;

  const suspensionRisk = config.suspensionThreshold > 0 && stuckJobs.length >= config.suspensionThreshold;
  const lastSeenAgoSec = worker?.last_seen_at ? Math.max(0, nowSec - worker.last_seen_at) : null;

  // Liveness is driven by the stuck jobs, NOT by last_seen_at alone: the
  // subgraph's last_seen is on-chain activity, so a quiet-but-healthy worker can
  // read old without being broken. A job past its deadline is the hard signal.
  const liveness: Liveness = worker === null ? "unknown" : stuckJobs.length > 0 ? "stalled" : "fresh";

  const base: Omit<WorkerLivenessReport, "summary"> = {
    address: worker?.id ?? "",
    status: worker?.status ?? null,
    liveness,
    lastSeenAgoSec,
    activeJobCount: worker?.active_job_count ?? 0,
    stuckJobs,
    unackedCount,
    incompleteCount,
    slashExposureBps,
    slashExposureLcai,
    suspensionThreshold: config.suspensionThreshold,
    suspensionRisk,
  };
  return { ...base, summary: buildSummary(base) };
}
