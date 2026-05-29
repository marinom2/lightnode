import { fromWei } from "./utils";
import type { Job, ModelInfo } from "./subgraph";

/** Per-model performance, aggregated from a window of recent network jobs. */
export interface ModelStat {
  modelId: string;
  name: string;
  total: number; // jobs seen in the window
  success: number; // Completed + Released
  timedOut: number;
  disputed: number;
  inFlight: number; // Submitted + Acknowledged (not yet resolved)
  completionRate: number | null; // success / (resolved); null when nothing resolved yet
  p50: number | null; // ack -> completed latency, seconds
  p95: number | null;
  earnings: number; // LCAI summed over released jobs for this model
}

const isSuccess = (s: string) => /complet|releas/i.test(s);
const isTimedOut = (s: string) => /timed?[ _-]*out|timeout/i.test(s);
const isDisputed = (s: string) => /disput/i.test(s);
const isInFlight = (s: string) => /submit|acknowled|ack/i.test(s);

/** Nearest-rank percentile of an ascending-sorted array (null if empty). */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))];
}

/** Aggregate a window of network jobs into per-model performance, busiest first. */
export function aggregateModelStats(jobs: Job[], models: ModelInfo[]): ModelStat[] {
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
    let disputed = 0;
    let inFlight = 0;
    let earnings = 0;
    for (const j of e.jobs) {
      const s = j.state || "";
      // Order matters: a job is success XOR timeout XOR dispute XOR in-flight.
      if (isSuccess(s)) success++;
      else if (isTimedOut(s)) timedOut++;
      else if (isDisputed(s)) disputed++;
      else if (isInFlight(s)) inFlight++;
      earnings += fromWei(j.worker_share);
    }
    const resolved = success + timedOut + disputed;
    const lat = e.latencies.slice().sort((a, b) => a - b);
    out.push({
      modelId: id,
      name: nameById.get(id) ?? `${id.slice(0, 10)}…`,
      total: e.jobs.length,
      success,
      timedOut,
      disputed,
      inFlight,
      completionRate: resolved > 0 ? success / resolved : null,
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      earnings,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Flatten per-model stats to CSV (for the explorer's export button). */
export function modelStatsCsv(stats: ModelStat[]): string {
  const head = [
    "model",
    "jobs",
    "success",
    "timed_out",
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
    s.timedOut,
    s.disputed,
    s.inFlight,
    s.completionRate != null ? Math.round(s.completionRate * 100) : "",
    s.p50 ?? "",
    s.p95 ?? "",
    s.earnings.toFixed(3),
  ]);
  return [head, ...rows].map((r) => r.join(",")).join("\n");
}
