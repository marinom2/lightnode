import { createPublicClient, getAddress, http, toHex, pad, keccak256, toBytes } from "viem";
import type { PublicClient } from "viem";
import type { NetworkConfig, Worker, Job, JobTransactions, ModelInfo, NetworkStats, WorkerModel } from "./types.js";

// keccak256("JobSubmitted(uint256,uint256,address)")
const JOB_SUBMITTED_TOPIC: `0x${string}` = "0xfb47370368875d7490803c5653d9496d0a3c5e1b49a17f013ec37abd9d86d356";
// keccak256("JobCompleted(uint256,address,bytes32,bytes32)")
const JOB_COMPLETED_TOPIC: `0x${string}` = "0xdb545db74bae046337ed01971cf61569fd1a1460ff8ed511ab19ceaac1326377";

/** Default subgraph request timeout. Override per-call via the `timeoutMs` arg. */
export const DEFAULT_SUBGRAPH_TIMEOUT_MS = 12_000;

async function gql<T>(url: string, query: string, timeoutMs: number = DEFAULT_SUBGRAPH_TIMEOUT_MS): Promise<T> {
  // A non-positive timeout means "no deadline" - let the request run unbounded
  // (useful on a slow indexer where the default abort is too aggressive).
  const ctrl = new AbortController();
  const ms = timeoutMs > 0 ? timeoutMs : 0;
  const timer = ms > 0 ? setTimeout(() => ctrl.abort(), ms) : undefined;
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
    if ((e as Error).name === "AbortError") throw new Error(`subgraph timeout after ${ms}ms`);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
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

export async function fetchWorker(cfg: NetworkConfig, address: string, timeoutMs?: number): Promise<Worker | null> {
  try {
    const data = await gql<{ worker: Worker | null }>(
      cfg.subgraph,
      `{ worker(id:"${checksum(address)}") { id status stake active_job_count jobs_completed jobs_timed_out total_earned last_seen_at created_at } }`,
      timeoutMs,
    );
    return data.worker ?? null;
  } catch (e) {
    if (/not found/i.test((e as Error).message)) return null; // unknown worker
    throw e;
  }
}

/** Fetch one job by its on-chain id. Null when the indexer has never seen it. */
export async function fetchJob(cfg: NetworkConfig, jobId: string | bigint, timeoutMs?: number): Promise<Job | null> {
  const id = typeof jobId === "bigint" ? jobId.toString() : jobId;
  const data = await gql<{ job: Job | null }>(
    cfg.subgraph,
    `{ job(id:"${id}") { id state model_id worker submitted_at ack_at completed_at worker_share submit_block_number completion_block_number } }`,
    timeoutMs,
  );
  return data.job ?? null;
}

export async function fetchWorkerJobs(cfg: NetworkConfig, address: string, first = 20, timeoutMs?: number): Promise<Job[]> {
  const data = await gql<{ jobs: Job[] }>(
    cfg.subgraph,
    `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc, where:{worker:"${checksum(address)}"}) { id state model_id submitted_at ack_at completed_at worker_share submit_block_number completion_block_number } }`,
    timeoutMs,
  );
  return data.jobs ?? [];
}

/** Recent jobs across the whole network (not one worker), for analytics. */
export async function fetchRecentJobs(cfg: NetworkConfig, first = 1000, timeoutMs?: number): Promise<Job[]> {
  const data = await gql<{ jobs: Job[] }>(
    cfg.subgraph,
    `{ jobs(first:${first}, orderBy:submitted_at, orderDirection:desc) { id state model_id worker ack_at completed_at worker_share submit_block_number completion_block_number } }`,
    timeoutMs,
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
  opts: { publicClient?: PublicClient; job?: Job | null; timeoutMs?: number } = {},
): Promise<JobTransactions> {
  const id = typeof jobId === "bigint" ? jobId : BigInt(jobId);
  const job = opts.job !== undefined ? opts.job : await fetchJob(cfg, id, opts.timeoutMs);
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

/**
 * The on-chain model registrations for one worker. The Graph entity name is
 * `workermodels` (lowercase), and `is_active` flips when the operator
 * removes a registration. Independent of `Worker.status`: a deregistered
 * worker can still have rows here from when it was live.
 */
export async function fetchWorkerModels(cfg: NetworkConfig, address: string, timeoutMs?: number): Promise<WorkerModel[]> {
  const data = await gql<{ workermodels: WorkerModel[] }>(
    cfg.subgraph,
    `{ workermodels(where:{worker:"${checksum(address)}"}) { id worker model_id is_active created_at updated_at } }`,
    timeoutMs,
  );
  return data.workermodels ?? [];
}

/**
 * Known model tags, for recovering a name the indexer could not supply.
 *
 * WHY A LOCAL LIST: the web app keeps the full catalog (tags + measured sizes)
 * in lib/model-catalog.ts, but this package is published to npm standalone and
 * compiles with `rootDir: "src"` / `include: ["src"]` - a `../lib` import is
 * outside the program and would simply not exist in `dist/`. So the inversion is
 * duplicated here in its minimal form: tags only, no sizes (the SDK never sizes
 * a model). Add a tag in both places when the registry gains one.
 *
 * keccak256 is one-way, so this is a dictionary lookup over tags we KNOW, not a
 * decode: hash each tag, match the digest. An id we cannot match stays
 * unrecovered and is flagged - it is never guessed.
 *
 * Exported ONLY so tests/unit/sdk-consistency.test.ts can assert this list has
 * not drifted from lib/model-catalog.ts. Not part of the package's public API.
 */
export const KNOWN_MODEL_TAGS: readonly string[] = [
  "qwen3-embedding:0.6b",
  "llama3-8b",
  "qwen3-vl:8b",
  "gemma4:e2b",
  "gpt-oss:20b",
  "glm-4.7-flash",
  "qwen3-vl:30b",
  "llama3-70b",
  "qwen3-coder-next",
  "gpt-oss:120b",
];

/** modelId (lowercase keccak256 of the tag) -> tag. Built once, from the list. */
const TAG_BY_ID: ReadonlyMap<string, string> = new Map(
  KNOWN_MODEL_TAGS.map((t) => [keccak256(toBytes(t)).toLowerCase(), t]),
);

/** A 32-byte hex digest - i.e. what the registry uses as a model id. */
function isModelId(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s.trim());
}

/**
 * The real tag for one registry row, or null when we cannot recover it.
 * Never returns a guess: null is a first-class answer.
 */
function recoverModelTag(name: string | undefined, id: string): string | null {
  const rawId = (id ?? "").toLowerCase();
  const n = (name ?? "").trim();
  // Normal case: the indexer gave us a real tag. "Real" = anything that is not
  // the id echoed back, and not a bare digest standing in for one. The SHAPE
  // decides, not equality with `id`: a 32-byte digest is never a plausible tag,
  // and also requiring `n === rawId` let a row whose two fields disagreed be
  // returned as a "real tag" that was actually a raw hash - which callers would
  // then hash again into a second, bogus model id.
  const nameIsId = isModelId(n);
  if (n && !nameIsId) return n;
  return TAG_BY_ID.get(rawId || n.toLowerCase()) ?? null;
}

/**
 * The network's registered models, with names repaired at the boundary.
 *
 * A model's on-chain identity is `id = keccak256(tag)` (see modelId() in
 * inference.ts) and the registry stores nothing else - no name, no size. When a
 * model was whitelisted without its tag string the indexer echoes the id back as
 * `name` (`name === id`, true for most testnet rows today), so returning the row
 * untouched leaks a raw 66-char hash to every consumer. We invert it against the
 * known tags here, once, rather than in each caller.
 */
export async function fetchModels(cfg: NetworkConfig, timeoutMs?: number): Promise<ModelInfo[]> {
  const data = await gql<{ modelinfos: Omit<ModelInfo, "unnamed">[] }>(
    cfg.subgraph,
    `{ modelinfos { id name fee max_output_tokens is_whitelisted is_enabled } }`,
    timeoutMs,
  );
  return (data.modelinfos ?? []).map((m) => {
    const tag = recoverModelTag(m.name, m.id);
    // `id` is passed through verbatim - it is the subgraph's case-sensitive
    // entity key and callers join on it. The placeholder deliberately contains a
    // space and an ellipsis so it can never be mistaken for an Ollama tag.
    return { ...m, name: tag ?? `unnamed ${(m.id ?? "").toLowerCase().slice(0, 10)}…`, unnamed: tag === null };
  });
}

export async function fetchWorkers(cfg: NetworkConfig, first = 200, timeoutMs?: number): Promise<Worker[]> {
  const data = await gql<{ workers: Worker[] }>(
    cfg.subgraph,
    `{ workers(first:${first}) { id status stake active_job_count jobs_completed jobs_timed_out total_earned last_seen_at created_at } }`,
    timeoutMs,
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
