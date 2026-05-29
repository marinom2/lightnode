export type NetworkId = "mainnet" | "testnet";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  chainId: number;
  rpc: string;
  explorer: string;
  workerGateway: string;
  subgraph: string;
  /** Genesis predeploy, same address on both networks. */
  workerRegistry: string;
  aiConfig: string;
  jobRegistry: string;
  minStakeLcai: number;
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
}

export interface ModelInfo {
  id: string; // keccak256(model tag)
  name: string;
  fee: string; // wei
  max_output_tokens: number;
  is_whitelisted: boolean;
  is_enabled: boolean;
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
