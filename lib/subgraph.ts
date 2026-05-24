/**
 * Thin client over the LightChain workers subgraph (workers-api GraphQL).
 * Powers the live network stats on the landing page and the worker dashboard.
 *
 * Note: the per-model `active_worker_count` field on `modelinfos` is known to
 * read stale (zero) even when the pool is healthy — we derive liveness from the
 * `workers` list instead.
 */
import { NETWORKS, type NetworkId } from "./network";

export interface Worker {
  id: string;
  status: string; // active | deactivated | deregistered
  stake: string; // wei
  active_job_count?: number;
  jobs_completed?: number;
  jobs_timed_out?: number;
  total_earned?: string; // wei
  last_seen_at?: number; // unix seconds
  created_at?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  fee: string; // wei
  max_output_tokens: number;
  is_whitelisted: boolean;
  is_enabled: boolean;
}

async function gql<T>(network: NetworkId, query: string): Promise<T> {
  const url = NETWORKS[network].subgraph;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`subgraph ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? "subgraph error");
  return json.data as T;
}

export async function fetchWorkers(network: NetworkId, first = 200): Promise<Worker[]> {
  const data = await gql<{ workers: Worker[] }>(
    network,
    `{ workers(first:${first}) { id status stake active_job_count jobs_completed jobs_timed_out total_earned last_seen_at created_at } }`,
  );
  return data.workers ?? [];
}

export async function fetchWorker(network: NetworkId, address: string): Promise<Worker | null> {
  const data = await gql<{ worker: Worker | null }>(
    network,
    `{ worker(id:"${address.toLowerCase()}") { id status stake active_job_count jobs_completed jobs_timed_out total_earned last_seen_at created_at } }`,
  );
  return data.worker ?? null;
}

export async function fetchModels(network: NetworkId): Promise<ModelInfo[]> {
  const data = await gql<{ modelinfos: ModelInfo[] }>(
    network,
    `{ modelinfos { id name fee max_output_tokens is_whitelisted is_enabled } }`,
  );
  return data.modelinfos ?? [];
}

const FRESH_SECONDS = 20 * 60; // a worker seen within 20m is "live"

export function isLive(w: Pick<Worker, "status" | "last_seen_at">): boolean {
  if (w.status !== "active") return false;
  if (!w.last_seen_at) return false;
  return Math.floor(Date.now() / 1000) - w.last_seen_at < FRESH_SECONDS;
}

export interface NetworkStats {
  total: number;
  active: number;
  live: number;
  models: number;
  jobsCompleted: number;
  totalEarnedLcai: number;
}

export function summarize(workers: Worker[], models: ModelInfo[]): NetworkStats {
  let active = 0;
  let live = 0;
  let jobsCompleted = 0;
  let totalEarnedWei = 0n;
  for (const w of workers) {
    if (w.status === "active") active += 1;
    if (isLive(w)) live += 1;
    jobsCompleted += Number(w.jobs_completed ?? 0);
    try {
      totalEarnedWei += BigInt(w.total_earned ?? "0");
    } catch {
      /* ignore malformed */
    }
  }
  return {
    total: workers.length,
    active,
    live,
    models: models.filter((m) => m.is_enabled && m.is_whitelisted).length,
    jobsCompleted,
    totalEarnedLcai: Number(totalEarnedWei) / 1e18,
  };
}
