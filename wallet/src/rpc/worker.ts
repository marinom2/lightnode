/**
 * Worker-status reads, inlined with viem so the wallet has ZERO build-time
 * dependency on the lightnode-sdk monorepo package (which needs the repo's
 * hoisted @types/node to compile). Same 4 calls the SDK's WorkerOperator.status()
 * makes, against the LightChain mainnet worker contracts.
 */
import { type PublicClient, encodeFunctionData, parseAbi } from "viem";

// LightChain mainnet: WorkerRegistry is a genesis predeploy; AIConfig + JobRegistry are proxies.
const WORKER_REGISTRY = "0x0000000000000000000000000000000000001002" as const;
const AI_CONFIG = "0x24D11533C354092ed6E18b964257819cE78Ce77D" as const;
const JOB_REGISTRY = "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b" as const;

const REGISTRY_ABI = parseAbi([
  "function isWorkerRegistered(address) view returns (bool)",
  "function getWorkerStake(address) view returns (uint256)",
]);
const AI_CONFIG_ABI = parseAbi(["function getMinWorkerStake() view returns (uint256)"]);
const JOB_REGISTRY_ABI = parseAbi(["function workerBalance(address) view returns (uint256)"]);

export interface WorkerStatusView {
  registered: boolean;
  belowFloor: boolean;
  stakeLcai: number;
  minStakeLcai: number;
  headroomLcai: number;
  claimableLcai: number;
}

const toLcai = (wei: bigint) => Number(wei) / 1e18;

export async function readWorkerStatus(client: PublicClient, address: `0x${string}`): Promise<WorkerStatusView> {
  // minStake comes from AIConfig (canonical on both networks), not the registry getter.
  const [registered, stakeWei, minStakeWei, claimableWei] = await Promise.all([
    client.readContract({ address: WORKER_REGISTRY, abi: REGISTRY_ABI, functionName: "isWorkerRegistered", args: [address] }),
    client.readContract({ address: WORKER_REGISTRY, abi: REGISTRY_ABI, functionName: "getWorkerStake", args: [address] }),
    client.readContract({ address: AI_CONFIG, abi: AI_CONFIG_ABI, functionName: "getMinWorkerStake" }),
    client.readContract({ address: JOB_REGISTRY, abi: JOB_REGISTRY_ABI, functionName: "workerBalance", args: [address] }),
  ]);
  return {
    registered,
    belowFloor: registered && stakeWei < minStakeWei,
    stakeLcai: toLcai(stakeWei),
    minStakeLcai: toLcai(minStakeWei),
    headroomLcai: toLcai(stakeWei - minStakeWei),
    claimableLcai: toLcai(claimableWei),
  };
}

// ---- worker hub: network stats + own lifetime stats + claim -----------------

const WORKERS_API = "https://workers-api.mainnet.lightchain.ai/graphql";
const GQL_TIMEOUT_MS = 10000;

export interface NetworkStatsView {
  totalWorkers: number;
  activeWorkers: number;
  jobsCompleted: number;
  totalEarnedLcai: number;
  minStakeLcai: number;
}

export interface WorkerLifetimeView {
  jobsCompleted: number;
  jobsTimedOut: number;
  lifetimeEarnedLcai: number;
  lastSeenAt: string | null;
}

interface GqlWorker {
  status?: string;
  jobs_completed?: number;
  jobs_timed_out?: number;
  total_earned?: string;
  last_seen_at?: string;
}

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(WORKERS_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(GQL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`workers api ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "workers api error");
  if (!json.data) throw new Error("workers api: empty");
  return json.data;
}

/** Aggregated, parsed defensively: the indexer response is external input. */
export function aggregateWorkers(workers: unknown): Omit<NetworkStatsView, "minStakeLcai"> {
  const list = Array.isArray(workers) ? (workers as GqlWorker[]) : [];
  let active = 0;
  let jobs = 0;
  let earnedWei = 0n;
  for (const w of list) {
    if (w?.status === "active") active += 1;
    if (typeof w?.jobs_completed === "number" && Number.isFinite(w.jobs_completed)) jobs += w.jobs_completed;
    try {
      earnedWei += BigInt(w?.total_earned ?? "0");
    } catch {
      // junk earned value: skip it, keep the rest
    }
  }
  return { totalWorkers: list.length, activeWorkers: active, jobsCompleted: jobs, totalEarnedLcai: Number(earnedWei) / 1e18 };
}

export async function readNetworkStats(client: PublicClient): Promise<NetworkStatsView> {
  const [data, minStakeWei] = await Promise.all([
    gql<{ workers: GqlWorker[] }>("{ workers(first:500) { status jobs_completed total_earned } }"),
    client.readContract({ address: AI_CONFIG, abi: AI_CONFIG_ABI, functionName: "getMinWorkerStake" }),
  ]);
  return { ...aggregateWorkers(data.workers), minStakeLcai: toLcai(minStakeWei) };
}

export async function readWorkerLifetime(address: string): Promise<WorkerLifetimeView | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null; // never interpolate unvalidated input
  try {
    const data = await gql<{ worker: GqlWorker | null }>(`{ worker(id:"${address}") { jobs_completed jobs_timed_out total_earned last_seen_at } }`);
    const w = data.worker;
    if (!w) return null;
    let earned = 0;
    try {
      earned = Number(BigInt(w.total_earned ?? "0")) / 1e18;
    } catch {
      earned = 0;
    }
    return {
      jobsCompleted: typeof w.jobs_completed === "number" ? w.jobs_completed : 0,
      jobsTimedOut: typeof w.jobs_timed_out === "number" ? w.jobs_timed_out : 0,
      lifetimeEarnedLcai: earned,
      lastSeenAt: typeof w.last_seen_at === "string" ? w.last_seen_at : null,
    };
  } catch {
    return null; // lifetime stats are a bonus; the on-chain status is the source of truth
  }
}

const WITHDRAW_ABI = parseAbi(["function withdraw()"]);

/** Calldata for JobRegistry.withdraw() - pulls the claimable balance to the worker. */
export function withdrawTarget(): { to: `0x${string}`; data: `0x${string}` } {
  return { to: JOB_REGISTRY, data: encodeFunctionData({ abi: WITHDRAW_ABI, functionName: "withdraw" }) };
}
