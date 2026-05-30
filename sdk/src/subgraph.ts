import { getAddress } from "viem";
import type { NetworkConfig, Worker, Job, ModelInfo, NetworkStats } from "./types.js";

const TIMEOUT_MS = 12_000;

async function gql<T>(url: string, query: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`subgraph ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (json.errors) throw new Error(json.errors[0]?.message ?? "subgraph error");
    return json.data as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`subgraph timeout after ${TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function checksum(addr: string): string {
  try {
    return getAddress(addr as `0x${string}`);
  } catch {
    return addr;
  }
}

/** Convert a wei string to a number of whole tokens (18 decimals). */
export function fromWei(wei?: string): number {
  if (!wei) return 0;
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

export async function fetchWorker(cfg: NetworkConfig, address: string): Promise<Worker | null> {
  try {
    const data = await gql<{ worker: Worker | null }>(
      cfg.subgraph,
      `{ worker(id:"${checksum(address)}") { id status stake active_job_count jobs_completed jobs_timed_out total_earned last_seen_at created_at } }`,
    );
    return data.worker ?? null;
  } catch (e) {
    if (/not found/i.test((e as Error).message)) return null; // unknown worker
    throw e;
  }
}

/** Fetch one job by its on-chain id. Null when the indexer has never seen it. */
export async function fetchJob(cfg: NetworkConfig, jobId: string | bigint): Promise<Job | null> {
  const id = typeof jobId === "bigint" ? jobId.toString() : jobId;
  const data = await gql<{ job: Job | null }>(
    cfg.subgraph,
    `{ job(id:"${id}") { id state model_id worker submitted_at ack_at completed_at worker_share } }`,
  );
  return data.job ?? null;
}

export async function fetchWorkerJobs(cfg: NetworkConfig, address: string, first = 20): Promise<Job[]> {
  const data = await gql<{ jobs: Job[] }>(
    cfg.subgraph,
    `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc, where:{worker:"${checksum(address)}"}) { id state model_id submitted_at ack_at completed_at worker_share } }`,
  );
  return data.jobs ?? [];
}

/** Recent jobs across the whole network (not one worker), for analytics. */
export async function fetchRecentJobs(cfg: NetworkConfig, first = 1000): Promise<Job[]> {
  const data = await gql<{ jobs: Job[] }>(
    cfg.subgraph,
    `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc) { id state model_id worker ack_at completed_at worker_share } }`,
  );
  return data.jobs ?? [];
}

export async function fetchModels(cfg: NetworkConfig): Promise<ModelInfo[]> {
  const data = await gql<{ modelinfos: ModelInfo[] }>(
    cfg.subgraph,
    `{ modelinfos { id name fee max_output_tokens is_whitelisted is_enabled } }`,
  );
  return data.modelinfos ?? [];
}

export async function fetchWorkers(cfg: NetworkConfig, first = 200): Promise<Worker[]> {
  const data = await gql<{ workers: Worker[] }>(
    cfg.subgraph,
    `{ workers(first:${first}) { id status stake active_job_count jobs_completed jobs_timed_out total_earned last_seen_at created_at } }`,
  );
  return data.workers ?? [];
}

export function summarize(workers: Worker[], models: ModelInfo[]): NetworkStats {
  return {
    total: workers.length,
    active: workers.filter((w) => w.status === "active").length,
    jobsCompleted: workers.reduce((s, w) => s + (w.jobs_completed ?? 0), 0),
    totalEarnedLcai: workers.reduce((s, w) => s + fromWei(w.total_earned), 0),
    models: models.filter((m) => m.is_enabled && m.is_whitelisted).length,
  };
}
