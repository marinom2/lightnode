import { NETWORKS, WORKER_REGISTRY, REGISTRY_TOPICS } from "./networks.js";
import {
  fetchWorker,
  fetchWorkerJobs,
  fetchWorkerModels,
  fetchRecentJobs,
  fetchJob,
  fetchModels,
  fetchWorkers,
  summarize,
  fromWei,
  resolveJobTransactions,
} from "./subgraph.js";
import { isRegistered, fetchOnchainEligibleModels } from "./onchain.js";
import {
  aggregateModelStats,
  aggregateWorkerStats,
  networkAnalytics,
  modelStatsCsv,
  workerStatsCsv,
  workerJobsCsv,
} from "./analytics.js";
import {
  modelId as computeModelId,
  estimateJobFee,
  JOB_REGISTRY_CONSUMER_ABI,
  consumerGatewayUrl,
  consumerGatewayHost,
  prepareSession,
  submitPrompt,
  decryptResponse,
  generateEcdhKeyPair,
  runInference,
  runInferenceWithKey,
  runInferenceStream,
} from "./inference.js";
import { Conversation, chat } from "./chat.js";
import { runInferenceBatch } from "./batch.js";
import { Agent, parseAgentOutput } from "./agent.js";
import { preflight as workerPreflight, watch as workerWatch } from "./worker.js";
import {
  WorkerOperator,
  WORKER_REGISTRY_ABI,
  JOB_REGISTRY_OPERATOR_ABI,
  AI_CONFIG_ABI,
  JOB_STATE,
  decodeWorkerError,
  WorkerOpError,
  isWorkerOpError,
} from "./worker-operator.js";
import {
  Bridge,
  BRIDGE_ROUTE,
  HYPERLANE_ROUTER_ABI,
  ERC20_ABI,
  addressToBytes32,
  quoteBridgeFee,
  bridgeableBalance,
  bridgeAllowance,
  approveBridge,
  bridgeTransfer,
} from "./bridge.js";
import {
  DAO,
  DAO_ADDRESSES,
  ProposalState,
  PROPOSAL_STATE_LABEL,
  VoteSupport,
  GOVERNOR_ABI,
  VOTES_ABI,
} from "./dao.js";
import {
  OnchainModelRegistry,
  AIVM_MODEL_REGISTRY_ABI,
  BENCHMARK_REGISTRY_ABI,
  ModelStatus,
  MODEL_STATUS_LABEL,
} from "./onchain-models.js";
import {
  StalledWorkerError,
  OnChainRevertError,
  RelayTokenTimeoutError,
  GatewayAuthError,
  isStalledWorker,
} from "./errors.js";
import { GatewayClient, GatewayHttpError } from "./gateway.js";
import { siweSignIn, siweChallenge, siweVerify } from "./auth.js";
import * as crypto from "./crypto.js";
import type {
  NetworkId,
  NetworkConfig,
  Worker,
  Job,
  JobTransactions,
  ModelInfo,
  WorkerModel,
  ServedModel,
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

  /**
   * The on-chain model whitelist for one worker (rows from WorkerRegistry
   * events). Use this when you need to answer "what models is this worker
   * offering" - it is the authoritative signal, not derived from past jobs.
   * Rows can be `is_active: false` (operator removed the registration) or
   * outlive deregister: combine with {@link getWorker}.status to decide
   * whether the worker is currently serving them.
   */
  getWorkerModels(address: string): Promise<WorkerModel[]> {
    return fetchWorkerModels(this.network, address);
  }

  /**
   * The models a worker is serving, RECONCILED against the chain. getWorkerModels
   * returns the raw subgraph rows, which go stale after a deregister/re-register
   * (the indexer never clears removals). This joins those rows to model names AND
   * to the authoritative on-chain WorkerRegistry.isEligible(worker, modelId), so
   * each `ServedModel` carries both `indexedActive` (subgraph) and
   * `onchainEligible` (chain truth). Use `onchainEligible === true` to decide what
   * the worker ACTUALLY serves right now; it falls back to null (rely on
   * `indexedActive`) if the chain read is unavailable.
   */
  async getServedModels(address: string): Promise<ServedModel[]> {
    const [rows, registry] = await Promise.all([
      fetchWorkerModels(this.network, address),
      fetchModels(this.network),
    ]);
    if (rows.length === 0) return [];
    const byId = new Map(registry.map((m) => [m.id.toLowerCase(), m]));
    const eligible = await fetchOnchainEligibleModels(
      this.network,
      address,
      rows.map((r) => r.model_id),
    ).catch(() => null);
    return rows.map((r) => {
      const info = byId.get(r.model_id.toLowerCase());
      return {
        modelId: r.model_id,
        name: info?.name ?? null,
        feeWei: info?.fee,
        maxOutputTokens: info?.max_output_tokens,
        indexedActive: r.is_active,
        onchainEligible: eligible ? (eligible.get(r.model_id.toLowerCase()) ?? null) : null,
      };
    });
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

  /**
   * One job's current status, classified for builders deciding whether to
   * retry / claim a refund / accept the answer. `category` is the
   * builder-friendly label; `raw` is the indexer's literal state string.
   * Null when the indexer has never seen the job (still pending propagation).
   */
  async getJobStatus(
    jobId: string | bigint,
    opts: { withTransactions?: boolean } = {},
  ): Promise<{
    id: string;
    raw: string;
    category: "submitted" | "in-flight" | "completed" | "stalled" | "disputed" | "resolved" | "unknown";
    worker: string | null;
    model: string | null;
    submittedAt: number | null;
    completedAt: number | null;
    workerShareLcai: number;
    refundable: boolean;
    /** Block numbers as the indexer recorded them. Null until indexer sees the event. */
    submitBlock: number | null;
    completionBlock: number | null;
    /**
     * Tx hashes for submitJob + jobCompleted, only resolved when
     * `withTransactions: true`. Each hash deep-links to Lightscan via
     * {@link Network.explorerTxUrl}. Costs one eth_getLogs RPC call per
     * transaction (max two per job); skip the flag if you don't need them.
     */
    submitTx: `0x${string}` | null;
    completionTx: `0x${string}` | null;
  } | null> {
    const j = await fetchJob(this.network, jobId);
    if (!j) return null;
    const state = (j.state ?? "").trim();
    const stateLow = state.toLowerCase();
    const category =
      /completed|released|paid/.test(stateLow)
        ? ("completed" as const)
        : /timed.?out|stalled|expired/.test(stateLow)
          ? ("stalled" as const)
          : /disputed/.test(stateLow)
            ? ("disputed" as const)
            : /resolved/.test(stateLow)
              ? ("resolved" as const)
              : /ack/.test(stateLow)
                ? ("in-flight" as const)
                : /submitted/.test(stateLow)
                  ? ("submitted" as const)
                  : ("unknown" as const);
    // A refund is on the table when the worker accepted the job but never
    // produced an answer within the protocol's dispute window. The protocol's
    // own timeout/dispute pipeline reclaims the fee; this flag is the SDK's
    // builder-facing hint that the on-chain refund call is the right path.
    const refundable = category === "stalled" || category === "disputed";
    // Tx hashes need a second RPC roundtrip. Opt in only - the historical
    // shape of getJobStatus stays pure-subgraph for callers who don't ask.
    const txs = opts.withTransactions
      ? await resolveJobTransactions(this.network, j.id, { job: j })
      : { submit: null as `0x${string}` | null, completion: null as `0x${string}` | null };
    return {
      id: j.id,
      raw: state,
      category,
      worker: j.worker ?? null,
      model: j.model_id ?? null,
      submittedAt: j.submitted_at ?? null,
      completedAt: j.completed_at ?? null,
      workerShareLcai: fromWei(j.worker_share),
      refundable,
      submitBlock: j.submit_block_number ?? null,
      completionBlock: j.completion_block_number && j.completion_block_number > 0 ? j.completion_block_number : null,
      submitTx: txs.submit,
      completionTx: txs.completion,
    };
  }

  /**
   * Build a Lightscan URL for an arbitrary address or tx hash on this
   * network. Useful for surfacing deep-links in builder UIs without
   * each consumer needing to know which explorer corresponds to which
   * chain.
   */
  explorerAddressUrl(address: string): string {
    return `${this.network.explorer}/address/${address}`;
  }

  explorerTxUrl(hash: string): string {
    return `${this.network.explorer}/tx/${hash}`;
  }

  explorerBlockUrl(block: number | bigint): string {
    return `${this.network.explorer}/block/${block.toString()}`;
  }

  /** keccak256 of a model tag (its on-chain + indexer id). */
  modelId(tag: string): `0x${string}` {
    return computeModelId(tag);
  }

  /** On-chain inference fee for a model, in whole LCAI (what submitJob must be paid). */
  estimateFee(modelTag: string): Promise<number> {
    return estimateJobFee(this.network, modelTag);
  }

  /**
   * Configured `GatewayClient` for this network, ready to call the consumer-api
   * endpoints (`prepareSession` / `uploadBlob` / `getSessionToken`). Pass a
   * `bearer` (token or thunk) from your SIWE-authenticated session; the SDK
   * does NOT bundle the SIWE handshake.
   */
  gateway(opts: { bearer?: import("./gateway.js").BearerSource; baseUrl?: string } = {}): GatewayClient {
    return new GatewayClient({ network: this.network, ...opts });
  }
}

/**
 * Build-time SDK version. Useful for diagnostic prints in examples and apps so
 * the operator can confirm which version of the SDK is loaded at runtime
 * (especially in registry-proxy environments like StackBlitz where lockfiles
 * may pin an older minor than the local install command suggests).
 */
export const SDK_VERSION = "0.7.12";

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
  // v0.7.3 per-job transaction-hash resolver (lifts the upstream
  // subgraph's "block-only" Job entity to a deep-linkable Job + tx pair).
  resolveJobTransactions,
  // v0.7.10 SIWE sign-in against the consumer-api: returns a JWT bearer
  // the worker-gateway accepts. End-to-end wallet-signed inference with
  // no shared demo-wallet state.
  siweSignIn,
  siweChallenge,
  siweVerify,
  // v0.7.4 per-worker model-registration list (the authoritative "what is
  // this worker offering to serve" signal, not derived from past jobs).
  fetchWorkerModels,
  computeModelId as modelId,
  estimateJobFee,
  JOB_REGISTRY_CONSUMER_ABI,
  consumerGatewayUrl,
  consumerGatewayHost,
  // v0.3 inference-submit surface (BETA - see README "Submitting inference").
  GatewayClient,
  GatewayHttpError,
  prepareSession,
  submitPrompt,
  decryptResponse,
  generateEcdhKeyPair,
  crypto,
  // v0.4 high-level orchestrator: one call, full flow.
  runInference,
  // v0.4.3 key-in-answer-out shortcut: same flow, no viem/SIWE wiring.
  runInferenceWithKey,
  // v0.4.9 AsyncIterable<string> wrapper around runInferenceWithKey.
  runInferenceStream,
  // v0.5.0 multi-turn conversation helper (history client-side; one inference per turn).
  Conversation,
  chat,
  // v0.6.0 batch runner: many prompts, capped parallelism, stable result order.
  runInferenceBatch,
  // v0.6.0 ReAct-style agent: tool calling on any LightChain-hosted model.
  Agent,
  parseAgentOutput,
  // v0.5.0 worker preflight + watch (one real test inference + status polling).
  workerPreflight,
  workerWatch,
  // v0.5.0 Bridge SDK (Hyperlane Warp Route wrapper for LCAI <-> Ethereum).
  Bridge,
  BRIDGE_ROUTE,
  HYPERLANE_ROUTER_ABI,
  ERC20_ABI,
  addressToBytes32,
  quoteBridgeFee,
  bridgeableBalance,
  bridgeAllowance,
  approveBridge,
  bridgeTransfer,
  // v0.5.0 DAO SDK (LCAIGovernor wrapper on Ethereum mainnet).
  DAO,
  DAO_ADDRESSES,
  ProposalState,
  PROPOSAL_STATE_LABEL,
  VoteSupport,
  GOVERNOR_ABI,
  VOTES_ABI,
  // v0.5.0 On-chain model registry reader (AIVMModelRegistry + BenchmarkRegistry).
  OnchainModelRegistry,
  AIVM_MODEL_REGISTRY_ABI,
  BENCHMARK_REGISTRY_ABI,
  ModelStatus,
  MODEL_STATUS_LABEL,
  StalledWorkerError,
  OnChainRevertError,
  RelayTokenTimeoutError,
  GatewayAuthError,
  isStalledWorker,
  // v0.7.0 worker-OPERATOR surface: the write/ops side (stuck-job recovery,
  // Docker-free settle/exit, revert decoding, live config). Complements the
  // read-only worker preflight/watch above; does not duplicate it.
  WorkerOperator,
  WORKER_REGISTRY_ABI,
  JOB_REGISTRY_OPERATOR_ABI,
  AI_CONFIG_ABI,
  JOB_STATE,
  decodeWorkerError,
  WorkerOpError,
  isWorkerOpError,
};
export type { BearerSource, GatewayClientOptions, SelectSessionResult, PrepareSessionResult, UploadBlobResult, SessionTokenResult } from "./gateway.js";
export type { SessionPreparation, RunInferenceArgs, RunInferenceResult, RunInferenceWithKeyArgs, RunInferenceStreamResult } from "./inference.js";
export type { ChatRole, ChatMessage, ConversationOptions, ConversationSendResult } from "./chat.js";
export type { BatchPrompt, BatchResult, RunInferenceBatchArgs } from "./batch.js";
export type { AgentTool, AgentStep, AgentOptions, AgentRunResult } from "./agent.js";
export type { WorkerPreflightArgs, WorkerPreflightResult, WorkerWatchOptions, WorkerEventKind, WorkerEvent, WorkerWatchHandle } from "./worker.js";
export type { BridgeChain, BridgeEndpoints, BridgeTransferArgs } from "./bridge.js";
export type { DaoChain, DaoAddresses, ProposalSummary, ProposalRow, DaoConfig } from "./dao.js";
export type { BaseModel, ModelVariant, AccessTier, AccessPolicy, Benchmark, OnchainModelRegistryOptions } from "./onchain-models.js";
export type {
  MinimalWalletClient,
  MinimalPublicClient,
  WorkerOperatorOpts,
  WorkerProtocolConfig,
  WorkerStatus,
  DeregisterReadiness,
  StuckJob,
  EarningsBreakdown,
  OnchainJob,
  JobState,
  DecodedWorkerError,
} from "./worker-operator.js";
export type { NetworkId, NetworkConfig, Worker, Job, JobTransactions, ModelInfo, WorkerModel, ServedModel, NetworkStats, ModelStat, WorkerStat, NetworkAnalytics };
export type { SiweWalletClient, SiweChallenge, SiweVerifyResult, SiweSession } from "./auth.js";
