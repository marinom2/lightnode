/**
 * On-chain Model Registry reader (AIVMModelRegistry + BenchmarkRegistry).
 *
 * These contracts exist in `lightchain-protocol/lcai-smart-contract` and
 * describe the full base-model + variant + benchmark + access-policy
 * surface. As of the time of writing, no public mainnet/testnet deployment
 * address has been published by the LightChain team - so this module
 * exposes the typed ABI wrapper and asks the caller to supply the
 * deployment address when constructing the reader. When LightChain
 * publishes addresses, we will bake them into a `KNOWN_DEPLOYMENTS` map.
 *
 * Usage today (custom deployment):
 *
 *   const reader = new OnchainModelRegistry({
 *     publicClient,
 *     registry: "0x...",
 *     benchmarks: "0x...",
 *   });
 *   const baseIds = await reader.getBaseModelIds();
 *
 * Once LightChain ships the official deployment, this becomes:
 *
 *   const reader = new OnchainModelRegistry({ publicClient, network: "mainnet" });
 */

import { parseAbi } from "viem";

export const AIVM_MODEL_REGISTRY_ABI = parseAbi([
  "function getBaseModelIds() external view returns (string[])",
  "function getBaseModel(string modelId) external view returns ((string modelId, string baseModelCID, string metadataHash, string policyVersion, string benchmarkCID, uint256 createdAt, bool isActive))",
  "function getAllVariants() external view returns (string[])",
  "function getTrainerVariants(address trainer) external view returns (string[])",
  "function getVariant(string variantId) external view returns ((string variantId, string variantCID, string metadataHash, string parentModelId, address trainer, uint256 trainerStake, uint8 status, uint256 avgScore, string reportCID, uint256 submittedAt, uint256 validatedAt, uint256 finalizedAt, uint256 validatorCount, bool challengeWindowOpen, uint256 challengeDeadline))",
  "function isVariantAvailable(string variantId) external view returns (bool)",
  "function getAccessPolicy(string variantId) external view returns ((bool requireTicket, uint256 minStakeRequired, address ticketManager, uint256 ticketTTL))",
]);

export const BENCHMARK_REGISTRY_ABI = parseAbi([
  "function listBenchmarks() external view returns (string[])",
  "function listBenchmarksByDomain(string domain) external view returns (string[])",
  "function listBenchmarksByTask(string taskType) external view returns (string[])",
  "function getBenchmark(string benchmarkId) external view returns ((string benchmarkId, string domain, string taskType, string benchmarkCID, string metadataCID, string manifestHash, string wrappedDEK, string version, address curator, uint256 registeredAt, bool encrypted, bool active))",
  "function getBenchmarkForVariant(string domain, string taskType) external view returns (string benchmarkId)",
]);

/** Model status enum from AIVMModelRegistry. */
export enum ModelStatus {
  Submitted = 0,
  Validating = 1,
  Approved = 2,
  Rejected = 3,
  Finalized = 4,
  Deprecated = 5,
}

export const MODEL_STATUS_LABEL: Record<ModelStatus, string> = {
  [ModelStatus.Submitted]: "submitted",
  [ModelStatus.Validating]: "validating",
  [ModelStatus.Approved]: "approved",
  [ModelStatus.Rejected]: "rejected",
  [ModelStatus.Finalized]: "finalized",
  [ModelStatus.Deprecated]: "deprecated",
};

export interface BaseModel {
  modelId: string;
  baseModelCID: string;
  metadataHash: string;
  policyVersion: string;
  benchmarkCID: string;
  createdAt: bigint;
  isActive: boolean;
}

export interface ModelVariant {
  variantId: string;
  variantCID: string;
  metadataHash: string;
  parentModelId: string;
  trainer: `0x${string}`;
  trainerStake: bigint;
  status: ModelStatus;
  avgScore: bigint;
  reportCID: string;
  submittedAt: bigint;
  validatedAt: bigint;
  finalizedAt: bigint;
  validatorCount: bigint;
  challengeWindowOpen: boolean;
  challengeDeadline: bigint;
}

/**
 * Builder-friendly access tier inferred from the raw AccessPolicyConfig
 * fields. The contract's policy is more granular (ticket manager, TTL, etc.)
 * but most consumers want to know "is this model free / paywalled / gated".
 */
export type AccessTier = "free" | "paywalled" | "ticket-gated";

export interface AccessPolicy {
  requireTicket: boolean;
  minStakeRequiredWei: bigint;
  ticketManager: `0x${string}`;
  ticketTtlSecs: bigint;
  tier: AccessTier;
}

export interface Benchmark {
  benchmarkId: string;
  domain: string;
  taskType: string;
  benchmarkCID: string;
  metadataCID: string;
  manifestHash: string;
  wrappedDEK: string;
  version: string;
  curator: `0x${string}`;
  registeredAt: bigint;
  encrypted: boolean;
  active: boolean;
}

interface MinimalPublicClient {
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
}

export interface OnchainModelRegistryOptions {
  publicClient: MinimalPublicClient;
  /** Deployed AIVMModelRegistry address. */
  registry: `0x${string}`;
  /** Optional: deployed BenchmarkRegistry address for the benchmark methods. */
  benchmarks?: `0x${string}`;
}

/**
 * Typed reader for AIVMModelRegistry + BenchmarkRegistry. Pass deployed
 * contract addresses; the SDK does not bake in defaults until LightChain
 * publishes them.
 */
export class OnchainModelRegistry {
  readonly registry: `0x${string}`;
  readonly benchmarks: `0x${string}` | null;

  constructor(private readonly opts: OnchainModelRegistryOptions) {
    this.registry = opts.registry;
    this.benchmarks = opts.benchmarks ?? null;
  }

  // -------- AIVMModelRegistry reads --------

  getBaseModelIds(): Promise<string[]> {
    return this.opts.publicClient.readContract({
      address: this.registry,
      abi: AIVM_MODEL_REGISTRY_ABI,
      functionName: "getBaseModelIds",
    }) as Promise<string[]>;
  }

  getBaseModel(modelId: string): Promise<BaseModel> {
    return this.opts.publicClient.readContract({
      address: this.registry,
      abi: AIVM_MODEL_REGISTRY_ABI,
      functionName: "getBaseModel",
      args: [modelId],
    }) as Promise<BaseModel>;
  }

  getAllVariants(): Promise<string[]> {
    return this.opts.publicClient.readContract({
      address: this.registry,
      abi: AIVM_MODEL_REGISTRY_ABI,
      functionName: "getAllVariants",
    }) as Promise<string[]>;
  }

  getTrainerVariants(trainer: `0x${string}`): Promise<string[]> {
    return this.opts.publicClient.readContract({
      address: this.registry,
      abi: AIVM_MODEL_REGISTRY_ABI,
      functionName: "getTrainerVariants",
      args: [trainer],
    }) as Promise<string[]>;
  }

  async getVariant(variantId: string): Promise<ModelVariant> {
    const raw = (await this.opts.publicClient.readContract({
      address: this.registry,
      abi: AIVM_MODEL_REGISTRY_ABI,
      functionName: "getVariant",
      args: [variantId],
    })) as ModelVariant;
    return { ...raw, status: raw.status as ModelStatus };
  }

  isVariantAvailable(variantId: string): Promise<boolean> {
    return this.opts.publicClient.readContract({
      address: this.registry,
      abi: AIVM_MODEL_REGISTRY_ABI,
      functionName: "isVariantAvailable",
      args: [variantId],
    }) as Promise<boolean>;
  }

  /**
   * Variant access policy. The raw struct has four fields; this also adds
   * a `tier` heuristic ("free" / "paywalled" / "ticket-gated") for builders
   * who do not want to interpret the fields themselves.
   */
  async getAccessPolicy(variantId: string): Promise<AccessPolicy> {
    const raw = (await this.opts.publicClient.readContract({
      address: this.registry,
      abi: AIVM_MODEL_REGISTRY_ABI,
      functionName: "getAccessPolicy",
      args: [variantId],
    })) as {
      requireTicket: boolean;
      minStakeRequired: bigint;
      ticketManager: `0x${string}`;
      ticketTTL: bigint;
    };
    let tier: AccessTier = "free";
    if (raw.requireTicket) tier = "ticket-gated";
    else if (raw.minStakeRequired > 0n) tier = "paywalled";
    return {
      requireTicket: raw.requireTicket,
      minStakeRequiredWei: raw.minStakeRequired,
      ticketManager: raw.ticketManager,
      ticketTtlSecs: raw.ticketTTL,
      tier,
    };
  }

  /** Return only the variants whose parentModelId matches `baseModelId`. */
  async getVariantsForBaseModel(baseModelId: string): Promise<ModelVariant[]> {
    const allIds = await this.getAllVariants();
    const variants = await Promise.all(allIds.map((id) => this.getVariant(id)));
    return variants.filter((v) => v.parentModelId === baseModelId);
  }

  // -------- BenchmarkRegistry reads --------

  private requireBenchmarks(): `0x${string}` {
    if (!this.benchmarks)
      throw new Error("OnchainModelRegistry: no BenchmarkRegistry address; pass `benchmarks` in the constructor");
    return this.benchmarks;
  }

  listBenchmarks(): Promise<string[]> {
    return this.opts.publicClient.readContract({
      address: this.requireBenchmarks(),
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: "listBenchmarks",
    }) as Promise<string[]>;
  }

  listBenchmarksByDomain(domain: string): Promise<string[]> {
    return this.opts.publicClient.readContract({
      address: this.requireBenchmarks(),
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: "listBenchmarksByDomain",
      args: [domain],
    }) as Promise<string[]>;
  }

  getBenchmark(benchmarkId: string): Promise<Benchmark> {
    return this.opts.publicClient.readContract({
      address: this.requireBenchmarks(),
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: "getBenchmark",
      args: [benchmarkId],
    }) as Promise<Benchmark>;
  }

  getBenchmarkForVariant(domain: string, taskType: string): Promise<string> {
    return this.opts.publicClient.readContract({
      address: this.requireBenchmarks(),
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: "getBenchmarkForVariant",
      args: [domain, taskType],
    }) as Promise<string>;
  }
}
