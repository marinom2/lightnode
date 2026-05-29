/**
 * Thin client over the LightChain workers subgraph (workers-api GraphQL).
 * Powers the live network stats on the landing page and the worker dashboard.
 *
 * Note: the per-model `active_worker_count` field on `modelinfos` is known to
 * read stale (zero) even when the pool is healthy - we derive liveness from the
 * `workers` list instead.
 */
import { getAddress } from "viem";
import { NETWORKS, type NetworkId } from "./network";

/** The subgraph stores checksummed addresses and is case-sensitive on `id`. */
function checksum(address: string): string {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

export interface Worker {
  id: string;
  status: string; // active | deactivated | deregistered
  stake: string; // wei
  active_job_count?: number;
  jobs_completed?: number;
  jobs_timed_out?: number;
  disputes_lost?: number;
  total_earned?: string; // wei
  last_seen_at?: number; // unix seconds
  created_at?: number;
}

export interface Job {
  id: string;
  state: string; // Completed | Acknowledged | Submitted | ...
  model_id?: string; // keccak256 of the model tag; joins to ModelInfo.id
  worker?: string; // checksummed worker address that took the job
  submitted_at?: number;
  ack_at?: number; // when the worker acknowledged it (start of its processing clock)
  completed_at?: number;
  submit_block_number?: number;
  completion_block_number?: number;
  worker_share?: string; // wei
}

export interface ModelInfo {
  id: string;
  name: string;
  fee: string; // wei
  max_output_tokens: number;
  is_whitelisted: boolean;
  is_enabled: boolean;
}

const TIMEOUT_MS = 12_000;

async function gql<T>(network: NetworkId, query: string): Promise<T> {
  const url = NETWORKS[network].subgraph;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`subgraph ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message ?? "subgraph error");
    return json.data as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`subgraph timeout after ${TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWorkers(network: NetworkId, first = 200): Promise<Worker[]> {
  const data = await gql<{ workers: Worker[] }>(
    network,
    `{ workers(first:${first}) { id status stake active_job_count jobs_completed jobs_timed_out total_earned last_seen_at created_at } }`,
  );
  return data.workers ?? [];
}

export async function fetchWorker(network: NetworkId, address: string): Promise<Worker | null> {
  try {
    const data = await gql<{ worker: Worker | null }>(
      network,
      `{ worker(id:"${checksum(address)}") { id status stake active_job_count jobs_completed jobs_timed_out disputes_lost total_earned last_seen_at created_at } }`,
    );
    return data.worker ?? null;
  } catch (e) {
    // The subgraph throws "Row not found" for unknown workers - treat as null.
    if (/not found/i.test((e as Error).message)) return null;
    throw e;
  }
}

export async function fetchWorkerJobs(network: NetworkId, address: string, first = 8): Promise<Job[]> {
  try {
    const data = await gql<{ jobs: Job[] }>(
      network,
      `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc, where:{worker:"${checksum(address)}"}) { id state submitted_at ack_at completed_at submit_block_number completion_block_number worker_share } }`,
    );
    return data.jobs ?? [];
  } catch {
    return []; // jobs feed is best-effort; never block the dashboard
  }
}

/** Recent jobs across the WHOLE network (not one worker), for per-model analytics. */
export async function fetchRecentJobs(network: NetworkId, first = 1000): Promise<Job[]> {
  try {
    const data = await gql<{ jobs: Job[] }>(
      network,
      `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc) { id state model_id worker ack_at completed_at worker_share } }`,
    );
    return data.jobs ?? [];
  } catch {
    return []; // analytics are best-effort; never block the page
  }
}

export async function fetchModels(network: NetworkId): Promise<ModelInfo[]> {
  const data = await gql<{ modelinfos: ModelInfo[] }>(
    network,
    `{ modelinfos { id name fee max_output_tokens is_whitelisted is_enabled } }`,
  );
  return data.modelinfos ?? [];
}

/** A model a specific worker serves, joined to its registry info (name/fee/limit). */
export interface ServedModel {
  name: string;
  fee?: string; // wei
  maxOutput?: number;
  active: boolean;
}

export async function fetchWorkerModels(network: NetworkId, address: string): Promise<ServedModel[]> {
  try {
    const [wm, models] = await Promise.all([
      gql<{ workermodels: { model_id: string; is_active: boolean }[] }>(
        network,
        `{ workermodels(where:{worker:"${checksum(address)}"}) { model_id is_active } }`,
      ),
      fetchModels(network),
    ]);
    const byId = new Map(models.map((m) => [m.id.toLowerCase(), m]));
    return (wm.workermodels ?? []).map((w) => {
      const info = byId.get(w.model_id.toLowerCase());
      return {
        name: info?.name ?? `${w.model_id.slice(0, 10)}…`,
        fee: info?.fee,
        maxOutput: info?.max_output_tokens,
        active: w.is_active,
      };
    });
  } catch {
    return []; // best-effort; never block the worker view
  }
}

// The subgraph's last_seen_at tracks last on-chain activity, not a real-time
// heartbeat - even busy workers read minutes/hours old. So "live" reflects the
// reliable on-chain signal (registered + active). Real container liveness is the
// local websocket, which the subgraph can't see (use Operations → Status).
export function isLive(w: Pick<Worker, "status" | "last_seen_at">): boolean {
  return w.status === "active";
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
