import type { Job, ModelInfo, ModelStat, NetworkAnalytics } from "./types.js";
import { fromWei } from "./subgraph.js";

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

/** Aggregate a window of network jobs into per-model performance, busiest first. */
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

/** Network-wide rollup across all models. */
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
