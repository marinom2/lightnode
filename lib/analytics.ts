import { fromWei } from "./utils";
import type { Job, ModelInfo } from "./subgraph";

/** Outcome buckets shared by per-model and per-worker aggregation. */
export interface JobBuckets {
  total: number;
  success: number; // Completed + Released + Resolved
  timedOut: number; // explicit TimedOut state
  stuck: number; // acked but never completed past the stuck window
  disputed: number;
  inFlight: number; // genuinely in progress (recent Submitted/Acknowledged)
  incomplete: number; // timedOut + stuck (taken but not finished)
  completionRate: number | null; // success / (success + incomplete + disputed)
  p50: number | null; // ack -> completed latency, seconds
  p95: number | null;
  earnings: number; // LCAI summed over released jobs
}

export interface ModelStat extends JobBuckets {
  modelId: string;
  name: string;
}

export interface WorkerStat extends JobBuckets {
  address: string;
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

/** Bucket a set of jobs into outcomes + latency percentiles + earnings. */
export function classifyJobs(jobs: Job[], nowSec: number): JobBuckets {
  let success = 0;
  let timedOut = 0;
  let stuck = 0;
  let disputed = 0;
  let inFlight = 0;
  let earnings = 0;
  const latencies: number[] = [];
  for (const j of jobs) {
    const s = j.state || "";
    if (isSuccess(s)) success++;
    else if (isTimedOut(s)) timedOut++;
    else if (isDisputed(s)) disputed++;
    else if (isAcked(s)) {
      if (j.ack_at && nowSec - j.ack_at > STUCK_SEC) stuck++;
      else inFlight++;
    } else if (isSubmitted(s)) inFlight++;
    earnings += fromWei(j.worker_share);
    if (j.ack_at && j.completed_at && j.completed_at >= j.ack_at) latencies.push(j.completed_at - j.ack_at);
  }
  const incomplete = timedOut + stuck;
  const resolved = success + incomplete + disputed;
  latencies.sort((a, b) => a - b);
  return {
    total: jobs.length,
    success,
    timedOut,
    stuck,
    disputed,
    inFlight,
    incomplete,
    completionRate: resolved > 0 ? success / resolved : null,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    earnings,
  };
}

function groupBy<T>(jobs: Job[], key: (j: Job) => string | undefined): Map<string, Job[]> {
  const m = new Map<string, Job[]>();
  for (const j of jobs) {
    const k = key(j);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(j);
    else m.set(k, [j]);
  }
  return m;
}

/** Per-model performance, busiest first. `nowSec` lets callers/tests classify stuck jobs deterministically. */
export function aggregateModelStats(
  jobs: Job[],
  models: ModelInfo[],
  nowSec: number = Math.floor(Date.now() / 1000),
): ModelStat[] {
  const nameById = new Map(models.map((m) => [m.id.toLowerCase(), m.name]));
  return [...groupBy(jobs, (j) => j.model_id?.toLowerCase()).entries()]
    .map(([id, js]) => ({ modelId: id, name: nameById.get(id) ?? `${id.slice(0, 10)}…`, ...classifyJobs(js, nowSec) }))
    .sort((a, b) => b.total - a.total);
}

/** Per-worker reliability, busiest first (top `limit`). */
export function aggregateWorkerStats(
  jobs: Job[],
  nowSec: number = Math.floor(Date.now() / 1000),
  limit = 25,
): WorkerStat[] {
  return [...groupBy(jobs, (j) => j.worker).entries()]
    .map(([address, js]) => ({ address, ...classifyJobs(js, nowSec) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
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

// Shared outcome columns for the per-model and per-worker stats exports, so both
// tables export an identical, comparable shape (only the first column differs).
const STATS_COLUMNS = [
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

function bucketsRow(s: JobBuckets): (string | number)[] {
  return [
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
  ];
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.join(",")).join("\n");
}

/** Flatten per-model stats to CSV (the analytics page's model export). */
export function modelStatsCsv(stats: ModelStat[]): string {
  return toCsv([["model", ...STATS_COLUMNS], ...stats.map((s) => [s.name, ...bucketsRow(s)])]);
}

/** Flatten per-worker reliability to CSV (the analytics page's worker export). */
export function workerStatsCsv(workers: WorkerStat[]): string {
  return toCsv([["worker", ...STATS_COLUMNS], ...workers.map((w) => [w.address, ...bucketsRow(w)])]);
}

/** Flatten one worker's job history to CSV (the worker view's export button). */
export function workerJobsCsv(jobs: Job[]): string {
  const head = [
    "job_id",
    "state",
    "model_id",
    "processing_s",
    "worker_share_lcai",
    "submitted_at",
    "ack_at",
    "completed_at",
    "submit_block",
    "completion_block",
  ];
  const rows = jobs.map((j) => [
    j.id,
    j.state,
    j.model_id ?? "",
    j.ack_at && j.completed_at && j.completed_at >= j.ack_at ? j.completed_at - j.ack_at : "",
    fromWei(j.worker_share).toFixed(6),
    j.submitted_at ?? "",
    j.ack_at ?? "",
    j.completed_at ?? "",
    j.submit_block_number ?? "",
    j.completion_block_number ?? "",
  ]);
  return toCsv([head, ...rows]);
}
