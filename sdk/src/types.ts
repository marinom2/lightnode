export type NetworkId = "mainnet" | "testnet";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  chainId: number;
  rpc: string;
  explorer: string;
  workerGateway: string;
  /**
   * LightChain consumer-api host (SIWE sign-in + JWT issuance). The worker
   * gateway accepts the JWT minted here as its Authorization Bearer.
   *
   * - `GET  {consumerApi}/api/auth/challenge?address=0x...` -> { nonce, message }
   * - `POST {consumerApi}/api/auth/verify`  body { message, signature } -> { token, ... }
   *
   * Wrapped end-to-end by {@link siweSignIn}.
   */
  consumerApi: string;
  subgraph: string;
  /** Genesis predeploy, same address on both networks. */
  workerRegistry: string;
  aiConfig: string;
  jobRegistry: string;
  minStakeLcai: number;
  /** FeePool genesis predeploy. Where per-job fees accumulate before payout. */
  feePool?: string;
  /** NativeVotes precompile (mainnet only - backs LightChainGovernor). */
  nativeVotes?: string;
  /** On-chain DAO governor (mainnet only today). */
  governor?: string;
  /** Governor timelock controller (mainnet only). */
  timelock?: string;
  /** DAO-controlled treasury (mainnet only). */
  treasury?: string;
  /**
   * SessionManager proxy. Live on testnet since the 2026-07-14 sortition
   * upgrade: staked workers are selected ON-CHAIN by racing
   * `claimSession(reqId)` (selector 0xf446092d) here, instead of being
   * dispatched by the worker gateway. Absent on mainnet (still gateway-dispatch).
   */
  sessionManager?: string;
  /**
   * True when worker selection is on-chain sortition (claimSession) rather than
   * gateway dispatch. Testnet only today. When true a worker must run in
   * sortition mode (SORTITION_ENABLED + SESSION_MANAGER_ADDRESS + local Redis);
   * a gateway-mode container never claims a session and serves no jobs.
   */
  sortition?: boolean;
}

export interface Worker {
  id: string;
  status: string; // active | deactivated | deregistered
  stake: string; // wei
  active_job_count?: number;
  jobs_completed?: number;
  jobs_timed_out?: number;
  total_earned?: string; // wei
  last_seen_at?: number;
  created_at?: number;
}

export interface Job {
  id: string;
  state: string; // Submitted | Acknowledged | Completed | TimedOut | Disputed | Resolved | Released
  model_id?: string; // keccak256 of the model tag; joins to ModelInfo.id
  worker?: string; // checksummed worker address that took the job
  submitted_at?: number;
  ack_at?: number;
  completed_at?: number;
  worker_share?: string; // wei
  // Block numbers come from the indexer; tx hashes do NOT (the upstream
  // subgraph entity has no transactionHash field). The SDK fills these in
  // on demand by re-scanning the exact block via eth_getLogs - see
  // resolveJobTransactions() in subgraph.ts.
  submit_block_number?: number;
  completion_block_number?: number;
}

/**
 * Per-job transaction hashes. Populated lazily by the SDK via
 * resolveJobTransactions(); not present on the raw subgraph Job entity.
 * `completion` is null until the worker emits JobCompleted.
 */
export interface JobTransactions {
  submit: `0x${string}` | null;
  completion: `0x${string}` | null;
}

export interface ModelInfo {
  id: string; // keccak256(model tag)
  name: string;
  fee: string; // wei
  max_output_tokens: number;
  is_whitelisted: boolean;
  is_enabled: boolean;
}

/**
 * Per-worker model registration row. The on-chain truth for "which models has
 * this worker offered to serve" - indexed from WorkerRegistry events.
 * `is_active` flips to false when the operator removes the registration; it
 * is independent of whether the worker itself is currently registered in the
 * protocol.
 */
export interface WorkerModel {
  id: string; // <worker>/<model_id>
  worker: string;
  model_id: string; // keccak256(model tag); joins to ModelInfo.id
  is_active: boolean;
  created_at?: number;
  updated_at?: number;
}

/**
 * A worker's served model, reconciled against the chain. Combines the subgraph
 * WorkerModel row (name, is_active) with the authoritative on-chain
 * WorkerRegistry.isEligible read, so you can tell a model the worker ACTUALLY
 * serves now from a stale index row left over after a deregister/re-register.
 */
export interface ServedModel {
  modelId: string; // keccak256(tag)
  name: string | null; // from the model registry, when known
  feeWei?: string;
  maxOutputTokens?: number;
  /** Subgraph WorkerModel.is_active (can be stale after deregister/re-register). */
  indexedActive: boolean;
  /**
   * On-chain WorkerRegistry.isEligible(worker, modelId) - the authoritative
   * "is it serving this right now". null when the chain read was unavailable.
   */
  onchainEligible: boolean | null;
}

export interface NetworkStats {
  total: number;
  active: number;
  jobsCompleted: number;
  totalEarnedLcai: number;
  models: number;
}

export interface JobBuckets {
  total: number;
  success: number; // Completed + Released + Resolved
  timedOut: number; // explicit TimedOut
  stuck: number; // acked but never completed past the stuck window
  disputed: number;
  inFlight: number; // genuinely in progress
  incomplete: number; // timedOut + stuck
  completionRate: number | null; // success / (success + incomplete + disputed)
  p50: number | null;
  p95: number | null;
  earnings: number;
}

export interface ModelStat extends JobBuckets {
  modelId: string;
  name: string;
}

export interface WorkerStat extends JobBuckets {
  address: string;
}

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
