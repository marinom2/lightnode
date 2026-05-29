import { NETWORKS, WORKER_REGISTRY, REGISTRY_TOPICS } from "./networks.js";
import {
  fetchWorker,
  fetchWorkerJobs,
  fetchRecentJobs,
  fetchModels,
  fetchWorkers,
  summarize,
  fromWei,
} from "./subgraph.js";
import { isRegistered } from "./onchain.js";
import {
  aggregateModelStats,
  aggregateWorkerStats,
  networkAnalytics,
  modelStatsCsv,
  workerStatsCsv,
  workerJobsCsv,
} from "./analytics.js";
import { modelId as computeModelId, estimateJobFee, JOB_REGISTRY_CONSUMER_ABI, consumerGatewayUrl } from "./inference.js";
import type {
  NetworkId,
  NetworkConfig,
  Worker,
  Job,
  ModelInfo,
  NetworkStats,
  ModelStat,
  WorkerStat,
  NetworkAnalytics,
} from "./types.js";

/**
 * Read-only client for a LightChain AI network. Pure reads from the public indexer
 * and the chain; no keys, no writes. Independent, community-built.
 *
 * ```ts
 * import { LightNode } from "lightnode-sdk";
 * const ln = new LightNode("mainnet");
 * const worker = await ln.getWorker("0x...");
 * const registered = await ln.isRegistered("0x..."); // on-chain truth
 * const perModel = await ln.getModelStats();
 * ```
 */
export class LightNode {
  readonly network: NetworkConfig;

  constructor(network: NetworkId | NetworkConfig = "mainnet") {
    this.network = typeof network === "string" ? NETWORKS[network] : network;
    if (!this.network) throw new Error(`unknown network: ${String(network)}`);
  }

  /** The full record for one worker (null if the indexer has never seen it). */
  getWorker(address: string): Promise<Worker | null> {
    return fetchWorker(this.network, address);
  }

  /** Recent jobs for one worker, newest first. */
  getWorkerJobs(address: string, first = 20): Promise<Job[]> {
    return fetchWorkerJobs(this.network, address, first);
  }

  /** The network's registered models (name, fee, output limit, whitelist flags). */
  getModels(): Promise<ModelInfo[]> {
    return fetchModels(this.network);
  }

  /** Registered workers (default top 200). */
  getWorkers(first = 200): Promise<Worker[]> {
    return fetchWorkers(this.network, first);
  }

  /** A one-shot summary: totals, active count, jobs completed, earnings, model count. */
  async getNetworkStats(): Promise<NetworkStats> {
    const [workers, models] = await Promise.all([fetchWorkers(this.network), fetchModels(this.network)]);
    return summarize(workers, models);
  }

  /** Per-model performance over the last `sample` jobs (completion, p50/p95, incomplete, disputes, earnings). */
  async getModelStats(sample = 1000): Promise<ModelStat[]> {
    const [jobs, models] = await Promise.all([fetchRecentJobs(this.network, sample), fetchModels(this.network)]);
    return aggregateModelStats(jobs, models);
  }

  /** Network-wide rollup across all models over the last `sample` jobs. */
  async getNetworkAnalytics(sample = 1000): Promise<NetworkAnalytics> {
    return networkAnalytics(await this.getModelStats(sample));
  }

  /** Per-worker reliability (completion, p50/p95, incomplete) over the last `sample` jobs, busiest first. */
  async getWorkerStats(sample = 1000, limit = 25): Promise<WorkerStat[]> {
    const jobs = await fetchRecentJobs(this.network, sample);
    return aggregateWorkerStats(jobs, Math.floor(Date.now() / 1000), limit);
  }

  /**
   * Authoritative registration read straight from the chain's WorkerRegistry events
   * (true/false), or null when the chain can't answer. Use this over getWorker().status
   * when you need certainty: the indexer can lag a deregister -> re-register cycle.
   */
  isRegistered(address: string): Promise<boolean | null> {
    return isRegistered(this.network, address);
  }

  /** Settled worker earnings in whole LCAI (from total_earned wei). */
  async getEarningsLcai(address: string): Promise<number> {
    const w = await fetchWorker(this.network, address);
    return w ? fromWei(w.total_earned) : 0;
  }

  /** keccak256 of a model tag (its on-chain + indexer id). */
  modelId(tag: string): `0x${string}` {
    return computeModelId(tag);
  }

  /** On-chain inference fee for a model, in whole LCAI (what submitJob must be paid). */
  estimateFee(modelTag: string): Promise<number> {
    return estimateJobFee(this.network, modelTag);
  }
}

export {
  NETWORKS,
  WORKER_REGISTRY,
  REGISTRY_TOPICS,
  aggregateModelStats,
  aggregateWorkerStats,
  networkAnalytics,
  modelStatsCsv,
  workerStatsCsv,
  workerJobsCsv,
  fromWei,
  computeModelId as modelId,
  estimateJobFee,
  JOB_REGISTRY_CONSUMER_ABI,
  consumerGatewayUrl,
};
export type { NetworkId, NetworkConfig, Worker, Job, ModelInfo, NetworkStats, ModelStat, WorkerStat, NetworkAnalytics };
