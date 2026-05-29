import { fromWei } from "./utils";
import type { Job, ModelInfo } from "./subgraph";

/** Per-model performance, aggregated from a window of recent network jobs. */
export interface ModelStat {
  modelId: string;
  name: string;
  total: number; // jobs seen in the window
  success: number; // Completed + Released + Resolved
  timedOut: number; // explicit TimedOut state
  stuck: number; // Acknowledged but never completed past the stuck window (de-facto failures)
  disputed: number;
  inFlight: number; // genuinely in progress (recent Submitted/Acknowledged)
  incomplete: number; // timedOut + stuck (taken but not finished)
  completionRate: number | null; // success / (success + incomplete + disputed); null when nothing resolved
  p50: number | null; // ack -> completed latency, seconds
  p95: number | null;
  earnings: number; // LCAI summed over released jobs for this model
}

// A job acked this long ago without completing has missed every deadline (the job
// deadline is ~120s) and is effectively a failure, even though the indexer often
// leaves it in "Acknowledged" rather than transitioning it to "TimedOut".
const STUCK_SEC = 600;

const isSuccess = (s: string) => /complet|releas|resolv/i.test(s);
const isTimedOut = (s: string) => /timed?[ _-]*out|timeout/i.test(s);
const isDisputed = (s: string) => /disput/i.test(s);
const isAcked = (s: string) => /acknowled|ack/i.test(s);
const isSubmitted = (s: string) => /submit/i.test(s);

/** Nearest-rank percentile of an ascending-sorted array (null if empty). */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))];
}

/**
 * Aggregate a window of network jobs into per-model performance, busiest first.
 * `nowSec` lets the caller (and tests) classify stuck jobs deterministically.
 */
export function aggregateModelStats(
  jobs: Job[],
  models: ModelInfo[],
  nowSec: number = Math.floor(Date.now() / 1000),
): ModelStat[] {
  const nameById = new Map(models.map((m) => [m.id.toLowerCase(), m.name]));
  const byModel = new Map<string, { jobs: Job[]; latencies: number[] }>();
  for (const j of jobs) {
    const id = (j.model_id ?? "").toLowerCase();
    if (!id) continue;
    let e = byModel.get(id);
    if (!e) {
      e = { jobs: [], latencies: [] };
      byModel.set(id, e);
    }
    e.jobs.push(j);
    if (j.ack_at && j.completed_at && j.completed_at >= j.ack_at) e.latencies.push(j.completed_at - j.ack_at);
  }

  const out: ModelStat[] = [];
  for (const [id, e] of byModel) {
    let success = 0;
    let timedOut = 0;
    let stuck = 0;
    let disputed = 0;
    let inFlight = 0;
    let earnings = 0;
    for (const j of e.jobs) {
      const s = j.state || "";
      if (isSuccess(s)) success++;
      else if (isTimedOut(s)) timedOut++;
      else if (isDisputed(s)) disputed++;
      else if (isAcked(s)) {
        // Acked but not completed: stuck if past the window (the indexer rarely
        // moves these to TimedOut, so we'd otherwise undercount failures).
        if (j.ack_at && nowSec - j.ack_at > STUCK_SEC) stuck++;
        else inFlight++;
      } else if (isSubmitted(s)) inFlight++;
      earnings += fromWei(j.worker_share);
    }
    const incomplete = timedOut + stuck;
    const resolved = success + incomplete + disputed;
    const lat = e.latencies.slice().sort((a, b) => a - b);
    out.push({
      modelId: id,
      name: nameById.get(id) ?? `${id.slice(0, 10)}…`,
      total: e.jobs.length,
      success,
      timedOut,
      stuck,
      disputed,
      inFlight,
      incomplete,
      completionRate: resolved > 0 ? success / resolved : null,
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      earnings,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Network-wide rollup across all models (the dashboard headline). */
export interface NetworkAnalytics {
  models: number;
  jobs: number;
  success: number;
  incomplete: number;
  disputed: number;
  inFlight: number;
  completionRate: number | null;
  earnings: number;
}

export function networkAnalytics(stats: ModelStat[]): NetworkAnalytics {
  const sum = (f: (s: ModelStat) => number) => stats.reduce((a, s) => a + f(s), 0);
  const success = sum((s) => s.success);
  const incomplete = sum((s) => s.incomplete);
  const disputed = sum((s) => s.disputed);
  const resolved = success + incomplete + disputed;
  return {
    models: stats.length,
    jobs: sum((s) => s.total),
    success,
    incomplete,
    disputed,
    inFlight: sum((s) => s.inFlight),
    completionRate: resolved > 0 ? success / resolved : null,
    earnings: sum((s) => s.earnings),
  };
}

/** Flatten per-model stats to CSV (for the explorer's export button). */
export function modelStatsCsv(stats: ModelStat[]): string {
  const head = [
    "model",
    "jobs",
    "success",
    "incomplete",
    "timed_out",
    "stuck",
    "disputed",
    "in_flight",
    "completion_rate_pct",
    "p50_latency_s",
    "p95_latency_s",
    "earnings_lcai",
  ];
  const rows = stats.map((s) => [
    s.name,
    s.total,
    s.success,
    s.incomplete,
    s.timedOut,
    s.stuck,
    s.disputed,
    s.inFlight,
    s.completionRate != null ? Math.round(s.completionRate * 100) : "",
    s.p50 ?? "",
    s.p95 ?? "",
    s.earnings.toFixed(3),
  ]);
  return [head, ...rows].map((r) => r.join(",")).join("\n");
}
