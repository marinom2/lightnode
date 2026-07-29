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
import { resolveModel } from "./model-catalog";

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
  /**
   * The model tag, repaired at the boundary by `fetchModels` - see there for why
   * the raw indexer value cannot be trusted. INVARIANT: when `unnamed` is falsy
   * this is the exact on-chain tag and is safe to hash / pull / serve.
   */
  name: string;
  fee: string; // wei
  max_output_tokens: number;
  is_whitelisted: boolean;
  is_enabled: boolean;
  /**
   * True when `name` is a placeholder, not a tag: the registration carried no
   * tag and the id is not one we know. Never hash or `ollama pull` such a name -
   * doing so mints a second, bogus model id. Optional so hand-built rows (test
   * fixtures, UI skeletons) stay valid and read as "named", which is correct for
   * a literal someone typed.
   */
  unnamed?: boolean;
}

/**
 * A registry row as it LEAVES `fetchModels`, where `unnamed` is required.
 *
 * The flag is optional on `ModelInfo` so hand-built literals keep compiling, but
 * that optionality is exactly what pushed consumers into re-deriving trust: a
 * renderer that cannot rely on the field falls back to re-resolving `name`, and
 * re-hashing a placeholder is how a second, bogus model id gets minted. Widening
 * the boundary's return type makes "this row already told you" a fact the
 * compiler enforces, so the UI can branch on `row.unnamed` and nothing else.
 */
export type ResolvedModelInfo = ModelInfo & { unnamed: boolean };

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
      `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc) { id state model_id worker submitted_at ack_at completed_at worker_share } }`,
    );
    return data.jobs ?? [];
  } catch {
    return []; // analytics are best-effort; never block the page
  }
}

/**
 * The network's registered models, with names repaired at the boundary.
 *
 * A model's on-chain identity is `id = keccak256(tag)` and the registry stores
 * nothing else - no tag, no name. When a model was whitelisted without its tag
 * string the indexer has nothing to put in `name` and echoes the id back
 * (`name === id`, true for 7 of the 10 testnet rows today). Returning that
 * untouched leaks a raw 66-char hash into every consumer: the models panel, the
 * worker dashboard, per-model analytics, and the size heuristics that regex over
 * the name. So we repair it here, once, instead of in each renderer.
 *
 * Recovery is a dictionary lookup over the known catalog (hash the tags we know,
 * match the digest) - keccak256 cannot be decoded. A tag we have never seen
 * therefore stays unrecovered: it gets a readable placeholder and `unnamed:
 * true` rather than a fabricated tag.
 *
 * The verdict travels ON the row (`unnamed`), so no consumer has to re-derive it
 * from the display string - see `ResolvedModelInfo`.
 */
export async function fetchModels(network: NetworkId): Promise<ResolvedModelInfo[]> {
  // The wire row has no `unnamed` - that flag is ours, added below.
  const data = await gql<{ modelinfos: Omit<ModelInfo, "unnamed">[] }>(
    network,
    `{ modelinfos { id name fee max_output_tokens is_whitelisted is_enabled } }`,
  );
  return (data.modelinfos ?? []).map((m) => {
    const r = resolveModel(m.name ?? "", m.id);
    // `id` is passed through verbatim: it is the subgraph's case-sensitive entity
    // key and every caller joins on it (lowercased) - normalizing here would
    // silently break `worker(id:)`-style round trips. `unnamed` is set on every
    // row, both verdicts - an absent flag would read as "named" downstream.
    return { ...m, name: r.label, unnamed: !r.known };
  });
}

/** A model a specific worker serves, joined to its registry info (name/fee/limit). */
export interface ServedModel {
  /** Repaired tag, same invariant as `ModelInfo.name`: real tag unless `unnamed`. */
  name: string;
  /** True when `name` is a placeholder we could not resolve to a tag. */
  unnamed?: boolean;
  modelId: string; // keccak id, for on-chain isEligible reconciliation
  fee?: string; // wei
  maxOutput?: number;
  active: boolean;
  /**
   * On-chain truth: does WorkerRegistry.isEligible(worker, modelId) confirm the
   * worker actually serves this model? The subgraph lists models from the LAST
   * registration and never indexes removals, so it goes stale after a
   * deregister/re-register. null = not checked (chain read unavailable).
   */
  onchainEligible?: boolean | null;
}

/** A served-model row as it LEAVES `fetchWorkerModels`. Same deal as `ResolvedModelInfo`. */
export type ResolvedServedModel = ServedModel & { unnamed: boolean };

export async function fetchWorkerModels(network: NetworkId, address: string): Promise<ResolvedServedModel[]> {
  try {
    const [wm, models] = await Promise.all([
      // `model_id` is typed nullable because the wire is: the entity field is
      // optional in the schema and a malformed row would otherwise blow up
      // `.toLowerCase()` below, throwing out of the map and into the catch -
      // blanking the worker's ENTIRE served-model list over one bad row.
      gql<{ workermodels: { model_id: string | null; is_active: boolean }[] }>(
        network,
        `{ workermodels(where:{worker:"${checksum(address)}"}) { model_id is_active } }`,
      ),
      fetchModels(network),
    ]);
    const byId = new Map(models.map((m) => [m.id.toLowerCase(), m]));
    return (wm.workermodels ?? []).map((w) => {
      // No id is just another id we cannot resolve: it comes back `unnamed`,
      // which is the truth, instead of taking the whole list down with it.
      const modelId = w.model_id ?? "";
      const info = byId.get(modelId.toLowerCase());
      // `info.name` is already repaired by fetchModels, but the join can miss
      // entirely: a worker can be registered for an id the registry query didn't
      // return (whitelist removed, or the row is newer than the models page). So
      // resolve from the id too rather than falling back to a bare hash prefix.
      // An `unnamed` registry row is fed in as "" on purpose - passing its
      // placeholder back would look like a real tag and re-flag it as known.
      const r = resolveModel(info && !info.unnamed ? info.name : "", modelId);
      return {
        name: r.label,
        // Explicit on every path, never inferred from `name`: a served model is
        // pullable/servable only when this is false.
        unnamed: !r.known,
        modelId,
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
