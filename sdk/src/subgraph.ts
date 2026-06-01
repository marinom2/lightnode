import { createPublicClient, getAddress, http, toHex, pad } from "viem";
import type { PublicClient } from "viem";
import type { NetworkConfig, Worker, Job, JobTransactions, ModelInfo, NetworkStats } from "./types.js";

// keccak256("JobSubmitted(uint256,uint256,address)")
const JOB_SUBMITTED_TOPIC: `0x${string}` = "0xfb47370368875d7490803c5653d9496d0a3c5e1b49a17f013ec37abd9d86d356";
// keccak256("JobCompleted(uint256,address,bytes32,bytes32)")
const JOB_COMPLETED_TOPIC: `0x${string}` = "0xdb545db74bae046337ed01971cf61569fd1a1460ff8ed511ab19ceaac1326377";

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
    `{ job(id:"${id}") { id state model_id worker submitted_at ack_at completed_at worker_share submit_block_number completion_block_number } }`,
  );
  return data.job ?? null;
}

export async function fetchWorkerJobs(cfg: NetworkConfig, address: string, first = 20): Promise<Job[]> {
  const data = await gql<{ jobs: Job[] }>(
    cfg.subgraph,
    `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc, where:{worker:"${checksum(address)}"}) { id state model_id submitted_at ack_at completed_at worker_share submit_block_number completion_block_number } }`,
  );
  return data.jobs ?? [];
}

/** Recent jobs across the whole network (not one worker), for analytics. */
export async function fetchRecentJobs(cfg: NetworkConfig, first = 1000): Promise<Job[]> {
  const data = await gql<{ jobs: Job[] }>(
    cfg.subgraph,
    `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc) { id state model_id worker ack_at completed_at worker_share submit_block_number completion_block_number } }`,
  );
  return data.jobs ?? [];
}

/**
 * Resolve a job's tx hashes (submitJob + jobCompleted) by re-scanning the
 * exact blocks the indexer recorded. The upstream subgraph entity stores
 * `submit_block_number` + `completion_block_number` but NOT the
 * transactionHash. Re-deriving them needs one RPC eth_getLogs call per
 * block: at most two calls per job, and each is tightly bounded
 * (single-block range, single contract, single topic, single jobId match).
 *
 * `submit` is null only if the indexer hasn't seen the job yet (we couldn't
 * resolve the block). `completion` is null until the worker emits
 * JobCompleted (still-in-flight or stalled jobs).
 *
 * Pass a `publicClient` to reuse an existing RPC connection. Without one
 * the function builds a transient client from `cfg.rpc` - simple but spends
 * a TCP handshake per call.
 */
export async function resolveJobTransactions(
  cfg: NetworkConfig,
  jobId: string | bigint,
  opts: { publicClient?: PublicClient; job?: Job | null } = {},
): Promise<JobTransactions> {
  const id = typeof jobId === "bigint" ? jobId : BigInt(jobId);
  const job = opts.job !== undefined ? opts.job : await fetchJob(cfg, id);
  if (!job) return { submit: null, completion: null };
  const client =
    opts.publicClient ??
    createPublicClient({ transport: http(cfg.rpc) });
  // Topic 1 is the indexed jobId, padded to 32 bytes. The subgraph keys
  // entries by exact on-chain jobId so this match is unambiguous.
  const jobTopic = pad(toHex(id), { size: 32 }) as `0x${string}`;
  const submitBlock = job.submit_block_number ? BigInt(job.submit_block_number) : null;
  const completionBlock = job.completion_block_number ? BigInt(job.completion_block_number) : null;
  // Address the contract that emits Job* events. JobRegistry handles both.
  const address = cfg.jobRegistry as `0x${string}` | undefined;
  if (!address) return { submit: null, completion: null };
  const [submitTx, completionTx] = await Promise.all([
    submitBlock !== null
      ? fetchTxHashForJobEvent(client, address, JOB_SUBMITTED_TOPIC, jobTopic, submitBlock)
      : Promise.resolve(null),
    completionBlock !== null && completionBlock > 0n
      ? fetchTxHashForJobEvent(client, address, JOB_COMPLETED_TOPIC, jobTopic, completionBlock)
      : Promise.resolve(null),
  ]);
  return { submit: submitTx, completion: completionTx };
}

type RawLog = {
  transactionHash?: `0x${string}` | null;
};

async function fetchTxHashForJobEvent(
  client: PublicClient,
  address: `0x${string}`,
  eventTopic: `0x${string}`,
  jobTopic: `0x${string}`,
  block: bigint,
): Promise<`0x${string}` | null> {
  // Bypass viem's typed getLogs - it rejects the [topic0, topic1] tuple
  // without a parsed `event` ABI, and we don't want to ship the full ABI
  // through this path. The raw eth_getLogs at the transport layer is what
  // we need: single block, single contract, two-topic match (event sig +
  // indexed jobId), so the response is at most one log.
  try {
    const blockHex = `0x${block.toString(16)}` as `0x${string}`;
    const logs = (await (client as unknown as { request: (args: unknown) => Promise<RawLog[]> }).request({
      method: "eth_getLogs",
      params: [
        {
          address,
          fromBlock: blockHex,
          toBlock: blockHex,
          topics: [eventTopic, jobTopic],
        },
      ],
    })) as RawLog[];
    return logs[0]?.transactionHash ?? null;
  } catch {
    return null;
  }
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
