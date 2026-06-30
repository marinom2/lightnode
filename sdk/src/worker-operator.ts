/**
 * Worker-OPERATOR module - the write/ops side of running a LightChain worker.
 *
 * The published `lightnode-sdk` is read-only (observe a worker) and the existing
 * `worker.ts` does remote preflight/watch. This module is different: it performs
 * the on-chain OPERATOR actions that, today, are either impossible from code or
 * require the multi-GB worker Docker image and reverse-engineering unverified
 * contracts. It is deliberately NOT a re-wrap of the worker toolkit's happy path:
 *
 *   1. Stuck-job recovery  - claimTimeout / clearStuck / unstickAndDeregister.
 *      The toolkit, the daemon, AND the published SDK all lack this. claimTimeout
 *      is permissionless on-chain (verified), so an operator CAN self-clear the
 *      acknowledged-but-never-completed jobs that block deregister. Nothing else
 *      exposes it.
 *   2. Revert decoding     - the WorkerRegistry/JobRegistry custom errors aren't
 *      even in the 4byte directory; decodeWorkerError turns them into a sentence
 *      plus the fix.
 *   3. Pre-flight gating   - canDeregister()/simulate tell you a tx will revert,
 *      and WHY, before you spend gas.
 *   4. Docker-free settle+exit - deregister/releaseJob/withdraw/stake ops over
 *      pure RPC, from a laptop / CI / server, with no worker image running.
 *   5. Real economics      - settled vs pending, claimable, profitability (net of
 *      gas), forecast - joins subgraph + on-chain workerBalance + window math.
 *   6. Live protocol config - the AIConfig stake/timeouts/slash-bps/fee-split, so
 *      nobody hardcodes "50,000" again.
 *   7. Typed getJob/getSession - the exact struct layouts (no published ABI).
 *
 * Conventions match the rest of the SDK: viem writes via a structural
 * `MinimalWalletClient` (viem stays a soft dep), `NETWORKS` for config, the
 * errors.ts class+guard style. Reuses `crypto.ts` for P-256 / AES-GCM.
 *
 * Source of truth for selectors/structs/errors: verified live on mainnet 9200 +
 * the official worker Go bindings. JobRegistry/WorkerRegistry impls are
 * UNVERIFIED on the explorer, so this is pinned to a snapshot - treat as 0.x and
 * lean on decodeWorkerError() to surface any future drift instead of failing
 * silently.
 */

import { parseAbi } from "viem";
import { NETWORKS } from "./networks.js";
import type { NetworkConfig, NetworkId } from "./types.js";

// ===========================================================================
// Structural viem types (soft dependency - same approach as inference.ts).
// ===========================================================================

// Both Minimal* shapes use method shorthand (not function properties) on
// purpose: TypeScript checks method parameters bivariantly, so a real viem
// client - whose methods take much stricter parameter types - is assignable
// here without casts. Function properties would be strictly contravariant
// and reject viem clients.
export interface MinimalWalletClient {
  // `args` is optional (viem's own parameter type marks it optional), so the
  // bivariant check succeeds in the viem -> Minimal direction. The SDK always
  // passes it.
  writeContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
    gas?: bigint;
  }): Promise<`0x${string}`>;
  account?: { address?: `0x${string}` } | `0x${string}`;
}

export interface MinimalPublicClient {
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    gasUsed?: bigint;
    effectiveGasPrice?: bigint;
  }>;
  // `account` also admits viem's Account object shape and null (viem types it
  // as `Account | Address | null`); the SDK itself only ever passes the bare
  // address.
  simulateContract?(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    account?: `0x${string}` | { address?: `0x${string}` } | null;
    value?: bigint;
  }): Promise<unknown>;
}

// ===========================================================================
// ABIs - minimal, operator-facing. Verified selectors (see module header).
// Human-readable strings; viem parseAbi-compatible if the caller wants typing.
// ===========================================================================

/** WorkerRegistry (genesis predeploy 0x...1002). Operator + stake surface. */
export const WORKER_REGISTRY_ABI = [
  "function registerWorker(bytes encryptionPubKey) payable",
  "function deregisterWorker()",
  "function addSupportedModel(bytes32 modelId)",
  "function removeSupportedModel(bytes32 modelId)",
  "function topUpStake() payable",
  "function withdrawStake(uint256 amount)",
  "function reinstate()",
  "function isWorkerRegistered(address worker) view returns (bool)",
  "function getWorkerStake(address worker) view returns (uint256)",
  "function getWorkerEncryptionKey(address worker) view returns (bytes)",
  "function getMinWorkerStake() view returns (uint256)",
  "function isEligible(address worker, bytes32 modelId) view returns (bool)",
] as const;

/** JobRegistry (proxy). Job lifecycle + settlement + the timeout primitive.
 *  The Job struct is a named human-readable struct (abitype needs a named
 *  struct, not an inline `tuple(...)`, for the getJob return). */
export const JOB_REGISTRY_OPERATOR_ABI = [
  "struct Job { uint256 jobId; address worker; uint8 state; uint256 escrowedFee; bytes32 promptBlobHash; bytes32 responseBlobHash; uint64 submittedAt; uint64 ackAt; uint64 completedAt; uint64 deadlineAt; uint256 r10; uint256 r11; uint256 r12; uint256 r13; uint256 r14; uint256 r15; uint256 submitBlockNumber; uint256 completionBlockNumber; }",
  "function acknowledgeJob(uint256 jobId)",
  "function completeJob(uint256 jobId, bytes32 responseBlobHash, bytes32 responseCiphertextHash)",
  "function releaseJob(uint256 jobId)",
  "function releaseJobs(uint256[] jobIds)",
  "function claimTimeout(uint256 jobId)",
  "function withdraw()",
  "function workerBalance(address worker) view returns (uint256)",
  "function getJob(uint256 jobId) view returns (Job)",
] as const;

/** AIConfig (verified ABI). Live protocol parameters. */
export const AI_CONFIG_ABI = [
  "function getMinWorkerStake() view returns (uint256)",
  "function getCompletionTimeout() view returns (uint256)",
  "function getAckTimeout() view returns (uint256)",
  "function getResolutionTimeout() view returns (uint256)",
  "function getDisputeWindow() view returns (uint256)",
  "function getTimeoutSlashBps() view returns (uint256)",
  "function getCompletionTimeoutSlashBps() view returns (uint256)",
  "function getDisputeSlashBps() view returns (uint256)",
  "function getMaxSlashBps() view returns (uint256)",
  "function getProtocolFeeBps() view returns (uint256)",
  "function getWorkerFeeBps() view returns (uint256)",
  "function getFeePoolBps() view returns (uint256)",
  "function getSuspensionThreshold() view returns (uint256)",
  "function getSuspensionCooldown() view returns (uint256)",
  "function getModelFee(bytes32 modelId) view returns (uint256)",
  "function isModelEnabled(bytes32 modelId) view returns (bool)",
] as const;

// viem's readContract/writeContract need a PARSED ABI (objects), not the
// human-readable strings above. We keep the strings exported for readability and
// parse them once here for the actual on-chain calls.
const WORKER_REGISTRY_ABI_PARSED = parseAbi(WORKER_REGISTRY_ABI);
const JOB_REGISTRY_OPERATOR_ABI_PARSED = parseAbi(JOB_REGISTRY_OPERATOR_ABI);
const AI_CONFIG_ABI_PARSED = parseAbi(AI_CONFIG_ABI);

// ===========================================================================
// Enums + struct types (pinned from the worker Go bindings + live decode).
// ===========================================================================

/** On-chain JobState. Order is ABI-load-bearing - do not reorder. */
export const JOB_STATE = [
  "Submitted",
  "Acknowledged",
  "Completed",
  "TimedOut",
  "Disputed",
  "Resolved",
  "Released",
] as const;
export type JobState = (typeof JOB_STATE)[number];

export interface OnchainJob {
  jobId: bigint;
  worker: `0x${string}`;
  state: JobState;
  /** Raw enum index, in case a future contract adds states. */
  stateIndex: number;
  escrowedFeeWei: bigint;
  promptBlobHash: `0x${string}`;
  responseBlobHash: `0x${string}`;
  submittedAt: number;
  ackAt: number;
  completedAt: number;
  deadlineAt: number;
  submitBlockNumber: bigint;
  completionBlockNumber: bigint;
}

// ===========================================================================
// 2) Revert decoding. These selectors are NOT in 4byte.directory - verified
//    live on mainnet. decodeWorkerError turns raw revert data into a sentence.
// ===========================================================================

export interface DecodedWorkerError {
  /** 4-byte selector, e.g. "0x592f994b". */
  selector: `0x${string}`;
  /** Solidity error name, or "Unknown" when unrecognized. */
  name: string;
  /** Decoded args, best-effort (uint/address words). */
  args: Array<string | bigint>;
  /** Plain-English explanation + the fix. */
  message: string;
}

interface ErrorSpec {
  name: string;
  /** ABI types in order (only uint256/address supported by the lite decoder). */
  types: Array<"uint256" | "address">;
  explain: (args: Array<string | bigint>) => string;
}

/** selector -> spec. Verified against live reverts on mainnet 9200. */
const WORKER_ERROR_TABLE: Record<string, ErrorSpec> = {
  "0x592f994b": {
    name: "ActiveJobsExist",
    types: ["address", "uint256"],
    explain: (a) =>
      `Can't deregister/withdraw yet: this worker still has ${a[1]} in-flight job(s) on-chain. ` +
      `Clear them first - acknowledged-but-unfinished jobs are cleared with claimTimeout (clearStuck() does this), ` +
      `then deregister succeeds.`,
  },
  "0xcb9a70eb": {
    name: "WorkerNotRegistered",
    types: ["address"],
    explain: (a) =>
      `Address ${a[0]} is not a registered worker (or the job/worker referenced doesn't exist). ` +
      `Register first, or check you're using the worker's own key.`,
  },
  "0x98f5b6c5": {
    name: "DisputeWindowNotElapsed",
    types: ["uint256", "uint256", "uint256"],
    explain: (a) => {
      const releaseAt = Number(a[1] ?? 0);
      const now = Number(a[2] ?? 0);
      const mins = releaseAt > now ? Math.ceil((releaseAt - now) / 60) : 0;
      return (
        `Job ${a[0]} isn't releasable yet - it's still inside the dispute window. ` +
        (mins ? `Releasable in ~${mins} min (at unix ${releaseAt}). ` : "") +
        `releaseAll() skips jobs that aren't ready; retry later.`
      );
    },
  },
  "0x45be0a26": {
    name: "InsufficientStake",
    types: ["uint256", "uint256"],
    explain: (a) =>
      `Insufficient stake: requested ${a[0]} but only ${a[1]} is available above the minimum. ` +
      `Withdraw less, or you're below the floor - topUpStake() then reinstate().`,
  },
  "0x50c83b95": {
    name: "JobNotFound",
    types: ["uint256"],
    explain: (a) => `Job ${a[0]} does not exist on this network.`,
  },
  "0x95e2fa37": {
    name: "SessionNotFound",
    types: ["uint256"],
    explain: (a) => `Session ${a[0]} does not exist on this network.`,
  },
  "0x149ce097": {
    name: "SessionNotActive",
    types: ["uint256"],
    explain: (a) => `Session ${a[0]} is not Active (closed or expired).`,
  },
  "0xa458261b": {
    name: "InsufficientFee",
    types: ["uint256", "uint256"],
    explain: (a) => `Underfunded: sent ${a[0]} wei but ${a[1]} is required.`,
  },
  "0xe06b2da5": {
    name: "NoBalanceToWithdraw",
    types: ["address"],
    explain: (a) => `Nothing to withdraw - ${a[0]} has a zero worker balance in the JobRegistry.`,
  },
  "0x4a0bfec1": {
    name: "NotAuthorized",
    types: ["address"],
    explain: (a) => `${a[0]} is not authorized for this action (disputer/dispatcher-gated).`,
  },
};

/** Read a 32-byte ABI word at slot i from hex data (after the 4-byte selector). */
function wordAt(dataNo0x: string, i: number): string {
  return dataNo0x.slice(i * 64, i * 64 + 64);
}

/**
 * Decode raw revert data (the `data: "0x.."` from an eth_call/estimateGas
 * failure) into a named, explained error. Falls back to {name:"Unknown"} so the
 * caller always gets *something* even if the contract drifts.
 */
export function decodeWorkerError(revertData: string | null | undefined): DecodedWorkerError {
  const data = (revertData ?? "").toLowerCase();
  if (!data.startsWith("0x") || data.length < 10) {
    return { selector: "0x" as `0x${string}`, name: "Unknown", args: [], message: "No revert data to decode." };
  }
  const selector = data.slice(0, 10) as `0x${string}`;
  const spec = WORKER_ERROR_TABLE[selector];
  const body = data.slice(10);
  if (!spec) {
    return {
      selector,
      name: "Unknown",
      args: [],
      message: `Unrecognized revert ${selector}. The worker contracts are unverified and may have changed; check the explorer.`,
    };
  }
  const args: Array<string | bigint> = spec.types.map((t, i) => {
    const w = wordAt(body, i);
    if (!w) return t === "address" ? "0x" : 0n;
    if (t === "address") return (`0x${w.slice(24)}`) as string;
    return BigInt(`0x${w || "0"}`);
  });
  return { selector, name: spec.name, args, message: spec.explain(args) };
}

/**
 * Operator-side typed error (mirrors the errors.ts convention: named class +
 * readonly fields + an `is...` guard). Carries the decoded contract error.
 */
export class WorkerOpError extends Error {
  readonly op: string;
  readonly decoded?: DecodedWorkerError;
  readonly tx?: `0x${string}`;
  constructor(op: string, message: string, opts?: { decoded?: DecodedWorkerError; tx?: `0x${string}` }) {
    super(message);
    this.name = "WorkerOpError";
    this.op = op;
    this.decoded = opts?.decoded;
    this.tx = opts?.tx;
  }
}

export function isWorkerOpError(e: unknown): e is WorkerOpError {
  return e instanceof WorkerOpError;
}

/** Pull the `data:` revert blob out of a viem/provider error of unknown shape. */
function extractRevertData(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  const walk = (o: unknown): string | undefined => {
    if (!o || typeof o !== "object" || seen.has(o)) return undefined;
    seen.add(o);
    const rec = o as Record<string, unknown>;
    for (const k of ["data", "raw"]) {
      const v = rec[k];
      if (typeof v === "string" && /^0x[0-9a-fA-F]{8,}$/.test(v)) return v;
      if (v && typeof v === "object") {
        const inner = (v as Record<string, unknown>).data;
        if (typeof inner === "string" && /^0x[0-9a-fA-F]{8,}$/.test(inner)) return inner;
      }
    }
    for (const k of ["cause", "error", "details", "walk"]) {
      const found = walk(rec[k]);
      if (found) return found;
    }
    return undefined;
  };
  return walk(err);
}

// ===========================================================================
// Config + helpers
// ===========================================================================

const BPS = 10_000n;

/** Live AIConfig protocol parameters (read from chain, never hardcoded). */
export interface WorkerProtocolConfig {
  minStakeWei: bigint;
  minStakeLcai: number;
  completionTimeoutSec: number;
  ackTimeoutSec: number;
  resolutionTimeoutSec: number;
  disputeWindowSec: number;
  /** Slash basis points: ack-timeout, completion-timeout, dispute, max cap. */
  slashBps: { ackTimeout: number; completionTimeout: number; dispute: number; max: number };
  /** Fee split basis points (protocol/worker/feePool sum to 10000). */
  feeBps: { protocol: number; worker: number; feePool: number };
  suspensionThreshold: number;
  suspensionCooldownSec: number;
}

export interface WorkerStatus {
  address: `0x${string}`;
  registered: boolean;
  stakeWei: bigint;
  stakeLcai: number;
  minStakeWei: bigint;
  /** stake - minStake, in LCAI (negative = below floor / deactivated). */
  headroomLcai: number;
  belowFloor: boolean;
  /** Claimable worker balance in the JobRegistry (earned, not yet withdrawn). */
  claimableWei: bigint;
  claimableLcai: number;
}

export interface DeregisterReadiness {
  ok: boolean;
  /** Every job ID blocking deregistration (the union of the buckets below). */
  blockedBy: bigint[];
  reason: string;
  /**
   * Completed jobs whose dispute window has elapsed: releasable RIGHT NOW with
   * zero slash (and they pay the worker its share). Settle these first.
   */
  releasableNow: bigint[];
  /**
   * Completed jobs still inside their dispute window: releasable later with zero
   * slash, once the window elapses. No action possible yet - retry after.
   */
  releasePending: bigint[];
  /**
   * In-flight jobs (Acknowledged or never-acked Submitted) past their deadline
   * that can ONLY be resolved via claimTimeout - which realizes a protocol slash.
   * `slashBps` is the per-job penalty (completion-timeout for Acknowledged,
   * ack-timeout for Submitted). There is no no-slash path for these on-chain.
   */
  slashableToClear: Array<{ jobId: bigint; state: JobState; slashBps: number }>;
  /**
   * Best-effort estimate of the stake (in LCAI) that clearing every
   * `slashableToClear` job would burn, capped at the protocol max-slash. The
   * exact figure depends on the chain's cap mechanics; treat as an upper-ish
   * guide, not a guarantee.
   */
  estimatedSlashLcai: number;
}

export interface StuckJob {
  /**
   * The ID to pass to claimTimeout/getJob - i.e. the SAME id you looked the job
   * up by (the subgraph/display id). IMPORTANT: this is NOT the struct's internal
   * `jobId` field, which is a different counter; calling claimTimeout with the
   * struct field hits the wrong job. Always use this lookupId for writes.
   */
  lookupId: bigint;
  /** The struct's internal jobId field (informational; do NOT use for writes). */
  jobId: bigint;
  state: JobState;
  ackAt: number;
  /** Seconds past the deadline (>0 means claimTimeout is eligible). */
  pastDeadlineSec: number;
  escrowedFeeWei: bigint;
  /**
   * The slash (basis points of stake) clearing this job via claimTimeout
   * realizes on the current network: the completion-timeout bps for an
   * Acknowledged job, the ack-timeout bps for a never-acked Submitted job
   * (0 on networks with slashing disabled, e.g. testnet).
   */
  slashBps: number;
}

/**
 * Uniform result for a per-job batch operation (clearStuck / releaseAll). One
 * shape for both so callers don't special-case `cleared`/`released` vs
 * `skipped`/`notReady`: `done` is what the op acted on (with tx hashes),
 * `skipped` is what it deliberately left alone, each with a plain-English reason.
 */
export interface BatchJobOpResult {
  /** Jobs the operation completed on-chain, each with its tx hash. */
  done: Array<{ jobId: bigint; tx: `0x${string}` }>;
  /** Jobs intentionally left untouched (not eligible), each with why. */
  skipped: Array<{ jobId: bigint; reason: string }>;
}

export interface EarningsBreakdown {
  /** Already withdrawn-able now (in the JobRegistry workerBalance). */
  claimableLcai: number;
  /** Lifetime earned (from the subgraph total_earned). */
  lifetimeLcai: number;
  /** Completed jobs awaiting their release window before they pay out. */
  pendingReleaseCount: number;
  jobsCompleted: number;
  jobsTimedOut: number;
}

const toLcai = (wei: bigint): number => Number(wei) / 1e18;
const toWeiFromLcai = (lcai: number): bigint => BigInt(Math.round(lcai * 1e18));

function normalizeJob(raw: unknown): OnchainJob {
  // viem returns the tuple either as an array or an object depending on ABI form.
  const t = raw as Record<string, unknown> & unknown[];
  const get = (k: string, i: number): unknown => (Array.isArray(t) ? t[i] : t[k]);
  const idx = Number(get("state", 2) ?? 0);
  return {
    jobId: BigInt((get("jobId", 0) as bigint | number | string) ?? 0),
    worker: (get("worker", 1) as `0x${string}`) ?? "0x",
    state: JOB_STATE[idx] ?? "Submitted",
    stateIndex: idx,
    escrowedFeeWei: BigInt((get("escrowedFee", 3) as bigint | number | string) ?? 0),
    promptBlobHash: (get("promptBlobHash", 4) as `0x${string}`) ?? "0x",
    responseBlobHash: (get("responseBlobHash", 5) as `0x${string}`) ?? "0x",
    submittedAt: Number(get("submittedAt", 6) ?? 0),
    ackAt: Number(get("ackAt", 7) ?? 0),
    completedAt: Number(get("completedAt", 8) ?? 0),
    deadlineAt: Number(get("deadlineAt", 9) ?? 0),
    submitBlockNumber: BigInt((get("submitBlockNumber", 16) as bigint | number | string) ?? 0),
    completionBlockNumber: BigInt((get("completionBlockNumber", 17) as bigint | number | string) ?? 0),
  };
}

// ===========================================================================
// WorkerOperator - the operator surface. Reads need only a publicClient;
// writes need a walletClient (same shape as the DAO/Bridge write classes).
// ===========================================================================

export interface WorkerOperatorOpts {
  publicClient: MinimalPublicClient;
  /** Required for writes (register/deregister/release/claimTimeout/withdraw/stake). */
  walletClient?: MinimalWalletClient;
  /** Worker address. Defaults to walletClient.account.address when present. */
  workerAddress?: `0x${string}`;
}

export class WorkerOperator {
  readonly network: NetworkConfig;
  private readonly pub: MinimalPublicClient;
  private readonly wallet?: MinimalWalletClient;
  // Optional: config() and protocol-level reads do not need a worker
  // address. The guard moves to the call sites that actually touch it.
  private readonly maybeAddr: `0x${string}` | undefined;
  private cfgCache?: WorkerProtocolConfig;

  constructor(network: NetworkId | NetworkConfig, opts: WorkerOperatorOpts) {
    this.network = typeof network === "string" ? NETWORKS[network] : network;
    if (!this.network) throw new Error(`WorkerOperator: unknown network ${String(network)}`);
    this.pub = opts.publicClient;
    this.wallet = opts.walletClient;
    const acct = opts.walletClient?.account;
    const fromWallet =
      typeof acct === "string" ? acct : (acct as { address?: `0x${string}` } | undefined)?.address;
    const a = (opts.workerAddress ?? fromWallet) as `0x${string}` | undefined;
    this.maybeAddr = a ? (a.toLowerCase() as `0x${string}`) : undefined;
  }

  private get addr(): `0x${string}` {
    if (!this.maybeAddr) {
      throw new Error(
        "WorkerOperator: this method needs the worker address. Pass `workerAddress` (or a `walletClient` with an account) when constructing WorkerOperator.",
      );
    }
    return this.maybeAddr;
  }

  private requireWallet(op: string): MinimalWalletClient {
    if (!this.wallet) throw new WorkerOpError(op, `${op} needs a walletClient - construct WorkerOperator with one.`);
    return this.wallet;
  }

  private get jobReg(): `0x${string}` {
    return this.network.jobRegistry as `0x${string}`;
  }
  private get workerReg(): `0x${string}` {
    return this.network.workerRegistry as `0x${string}`;
  }

  private async read(
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<unknown> {
    return this.pub.readContract({ address, abi, functionName, args });
  }

  /** Send a write and wait for the receipt, decoding any revert into a WorkerOpError. */
  private async send(
    op: string,
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
    value?: bigint,
  ): Promise<`0x${string}`> {
    const wallet = this.requireWallet(op);
    let tx: `0x${string}`;
    try {
      tx = await wallet.writeContract({ address, abi, functionName, args, ...(value !== undefined ? { value } : {}) });
    } catch (err) {
      const decoded = decodeWorkerError(extractRevertData(err));
      throw new WorkerOpError(op, `${op} reverted before broadcast: ${decoded.message}`, { decoded });
    }
    const receipt = await this.pub.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      throw new WorkerOpError(op, `${op} reverted on-chain (tx=${tx})`, { tx });
    }
    return tx;
  }

  /**
   * Pre-flight a write via eth_call when the publicClient exposes
   * simulateContract (viem PublicClients do; bare-bones test doubles may not).
   * A revert here costs zero gas and still gets the decodeWorkerError
   * treatment, so the caller learns WHY before anything is broadcast.
   * No-ops silently when simulation isn't available - the send() path keeps
   * its own decode-on-failure safety net either way.
   */
  private async simulateIfAvailable(
    op: string,
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
    value?: bigint,
  ): Promise<void> {
    if (!this.pub.simulateContract) return;
    try {
      await this.pub.simulateContract({
        address,
        abi,
        functionName,
        args,
        ...(this.maybeAddr ? { account: this.maybeAddr } : {}),
        ...(value !== undefined ? { value } : {}),
      });
    } catch (err) {
      const decoded = decodeWorkerError(extractRevertData(err));
      throw new WorkerOpError(op, `${op} would revert: ${decoded.message}`, { decoded });
    }
  }

  // ---- 6) Live protocol config -------------------------------------------

  /** Live AIConfig parameters (cached after first read). */
  async config(): Promise<WorkerProtocolConfig> {
    if (this.cfgCache) return this.cfgCache;
    const a = this.network.aiConfig as `0x${string}`;
    const r = (fn: string) => this.read(a, AI_CONFIG_ABI_PARSED, fn) as Promise<bigint>;
    const [
      minStake,
      completion,
      ack,
      resolution,
      dispute,
      ackSlash,
      compSlash,
      dispSlash,
      maxSlash,
      protoFee,
      workerFee,
      poolFee,
      suspThresh,
      suspCool,
    ] = await Promise.all([
      r("getMinWorkerStake"),
      r("getCompletionTimeout"),
      r("getAckTimeout"),
      r("getResolutionTimeout"),
      r("getDisputeWindow"),
      r("getTimeoutSlashBps"),
      r("getCompletionTimeoutSlashBps"),
      r("getDisputeSlashBps"),
      r("getMaxSlashBps"),
      r("getProtocolFeeBps"),
      r("getWorkerFeeBps"),
      r("getFeePoolBps"),
      r("getSuspensionThreshold"),
      r("getSuspensionCooldown"),
    ]);
    this.cfgCache = {
      minStakeWei: minStake,
      minStakeLcai: toLcai(minStake),
      completionTimeoutSec: Number(completion),
      ackTimeoutSec: Number(ack),
      resolutionTimeoutSec: Number(resolution),
      disputeWindowSec: Number(dispute),
      slashBps: {
        ackTimeout: Number(ackSlash),
        completionTimeout: Number(compSlash),
        dispute: Number(dispSlash),
        max: Number(maxSlash),
      },
      feeBps: { protocol: Number(protoFee), worker: Number(workerFee), feePool: Number(poolFee) },
      suspensionThreshold: Number(suspThresh),
      suspensionCooldownSec: Number(suspCool),
    };
    return this.cfgCache;
  }

  // ---- status / reads -----------------------------------------------------

  /** One-call worker status: registration, stake, floor, claimable balance. */
  async status(): Promise<WorkerStatus> {
    // minStake is sourced from AIConfig (verified live on BOTH networks), not
    // WorkerRegistry.getMinWorkerStake - the testnet WorkerRegistry impl differs
    // and reverts that getter. AIConfig is the canonical source either way.
    const [registered, stakeWei, minStakeWei, claimableWei] = await Promise.all([
      this.read(this.workerReg, WORKER_REGISTRY_ABI_PARSED, "isWorkerRegistered", [this.addr]) as Promise<boolean>,
      this.read(this.workerReg, WORKER_REGISTRY_ABI_PARSED, "getWorkerStake", [this.addr]) as Promise<bigint>,
      this.read(this.network.aiConfig as `0x${string}`, AI_CONFIG_ABI_PARSED, "getMinWorkerStake") as Promise<bigint>,
      this.read(this.jobReg, JOB_REGISTRY_OPERATOR_ABI_PARSED, "workerBalance", [this.addr]) as Promise<bigint>,
    ]);
    const headroomLcai = toLcai(stakeWei - minStakeWei);
    return {
      address: this.addr,
      registered,
      stakeWei,
      stakeLcai: toLcai(stakeWei),
      minStakeWei,
      headroomLcai,
      belowFloor: registered && stakeWei < minStakeWei,
      claimableWei,
      claimableLcai: toLcai(claimableWei),
    };
  }

  // ---- 7) Typed getJob ----------------------------------------------------

  /** Typed on-chain job (the struct layout has no published ABI). */
  async getJob(jobId: bigint | number): Promise<OnchainJob> {
    const raw = await this.read(this.jobReg, JOB_REGISTRY_OPERATOR_ABI_PARSED, "getJob", [BigInt(jobId)]);
    return normalizeJob(raw);
  }

  // ---- 1) Stuck-job recovery ---------------------------------------------

  /**
   * In-flight jobs this worker can only clear via claimTimeout - i.e. the ones
   * that block deregister and have no normal-completion exit. That's two states,
   * not one:
   *   - Acknowledged but never completed, past the completion deadline.
   *   - Submitted but never acknowledged, past the ack deadline (a never-acked
   *     job is still recorded against the worker and still blocks deregister;
   *     late acknowledgeJob/completeJob revert "deadline exceeded", so
   *     claimTimeout is the only resolution).
   * Each carries its per-state `slashBps` so callers can price the exit. Needs
   * the worker's job IDs (from the subgraph / LightNode client); on-chain there
   * is no enumerator. Pass the candidate IDs in.
   */
  async stuckJobs(candidateJobIds: Array<bigint | number>): Promise<StuckJob[]> {
    const cfg = await this.config();
    const now = Math.floor(Date.now() / 1000);
    const out: StuckJob[] = [];
    for (const id of candidateJobIds) {
      const j = await this.getJob(id);
      if (j.worker.toLowerCase() !== this.addr) continue;
      // Only never-finished in-flight states are claimTimeout-clearable. Completed
      // settles via releaseJob (no slash); all other states are terminal.
      if (j.state !== "Acknowledged" && j.state !== "Submitted") continue;
      // Deadline: prefer the on-chain deadlineAt (already the right one per state),
      // else recompute - ack deadline for Submitted, completion deadline for Acked.
      const fallback =
        j.state === "Submitted"
          ? j.submittedAt
            ? j.submittedAt + cfg.ackTimeoutSec
            : 0
          : j.ackAt
            ? j.ackAt + cfg.completionTimeoutSec
            : 0;
      const deadline = j.deadlineAt || fallback;
      const past = deadline ? now - deadline : 0;
      out.push({
        // The id the caller passed IS the claimTimeout/getJob key - not j.jobId.
        lookupId: BigInt(id),
        jobId: j.jobId,
        state: j.state,
        ackAt: j.ackAt,
        pastDeadlineSec: past,
        escrowedFeeWei: j.escrowedFeeWei,
        slashBps: j.state === "Acknowledged" ? cfg.slashBps.completionTimeout : cfg.slashBps.ackTimeout,
      });
    }
    return out;
  }

  /**
   * Clear one stuck (acknowledged-but-never-completed, past-deadline) job.
   * Permissionless on-chain - the worker itself may call it.
   *
   * MAINNET SLASH: this finalizes the job as TimedOut, which realizes the
   * completion-timeout slash on the worker's stake (mainnet:
   * `config().slashBps.completionTimeout` = 5% of stake per job at the time of
   * writing; TESTNET has slashing disabled, so it's free there). This is the
   * deliberate price of unblocking deregister - a stuck acked job otherwise
   * blocks the exit forever. Call `config()` first to see the live slash bps, and
   * only clear jobs you've accepted are lost. Verify eligibility with
   * `stuckJobs([id])` (pastDeadlineSec > 0) before calling.
   */
  async claimTimeout(jobId: bigint | number): Promise<`0x${string}`> {
    return this.send("claimTimeout", this.jobReg, JOB_REGISTRY_OPERATOR_ABI_PARSED, "claimTimeout", [BigInt(jobId)]);
  }

  /**
   * Clear every past-deadline acked job in `candidateJobIds`. Returns the unified
   * {@link BatchJobOpResult}: `done` are the jobs cleared (with tx), `skipped` are
   * acknowledged jobs not yet past their completion deadline. Each cleared job
   * realizes its completion-timeout slash - see slashBps.completionTimeout in
   * config(). (Candidate IDs that aren't acknowledged-and-stuck are not eligible
   * for claimTimeout and don't appear in either list.)
   */
  async clearStuck(candidateJobIds: Array<bigint | number>): Promise<BatchJobOpResult> {
    const stuck = await this.stuckJobs(candidateJobIds);
    const done: BatchJobOpResult["done"] = [];
    const skipped: BatchJobOpResult["skipped"] = [];
    for (const s of stuck) {
      if (s.pastDeadlineSec <= 0) {
        const inSec = Math.abs(s.pastDeadlineSec);
        skipped.push({
          jobId: s.lookupId,
          reason: `${s.state.toLowerCase()} but not yet past its timeout deadline (~${Math.ceil(inSec / 60)} min to go); claimTimeout would revert`,
        });
        continue;
      }
      // Use lookupId (the getJob/claimTimeout key), NOT the struct's jobId field.
      const tx = await this.claimTimeout(s.lookupId);
      done.push({ jobId: s.lookupId, tx });
    }
    return { done, skipped };
  }

  // ---- 3) Pre-flight gating ----------------------------------------------

  /**
   * Will deregister succeed right now, and at what cost? On-chain deregister is
   * blocked by ANY non-released job, so this classifies the candidates (on-chain
   * there's no enumerator - pass the worker's job IDs) into three buckets BEFORE
   * you spend gas: completed jobs releasable now (free), completed jobs still in
   * their dispute window (free later), and stuck in-flight jobs that only clear
   * via claimTimeout (slash). `estimatedSlashLcai` prices the last bucket.
   */
  async canDeregister(candidateJobIds: Array<bigint | number> = []): Promise<DeregisterReadiness> {
    const st = await this.status();
    const empty = { releasableNow: [], releasePending: [], slashableToClear: [], estimatedSlashLcai: 0 };
    if (!st.registered) return { ok: false, blockedBy: [], reason: "Worker is not registered.", ...empty };

    const cfg = await this.config();
    const now = Math.floor(Date.now() / 1000);
    const releasableNow: bigint[] = [];
    const releasePending: bigint[] = [];
    const slashableToClear: DeregisterReadiness["slashableToClear"] = [];
    const notYetClearable: bigint[] = [];

    for (const id of candidateJobIds) {
      const j = await this.getJob(id);
      if (j.worker.toLowerCase() !== this.addr) continue;
      const lookupId = BigInt(id);
      if (j.state === "Completed") {
        // Dispute window runs from completion; release is free once it elapses.
        const releaseAt = (j.completedAt || j.deadlineAt) + cfg.disputeWindowSec;
        (now >= releaseAt ? releasableNow : releasePending).push(lookupId);
        continue;
      }
      if (j.state === "Acknowledged" || j.state === "Submitted") {
        const fallback =
          j.state === "Submitted"
            ? j.submittedAt
              ? j.submittedAt + cfg.ackTimeoutSec
              : 0
            : j.ackAt
              ? j.ackAt + cfg.completionTimeoutSec
              : 0;
        const deadline = j.deadlineAt || fallback;
        if (deadline && now >= deadline) {
          const slashBps = j.state === "Acknowledged" ? cfg.slashBps.completionTimeout : cfg.slashBps.ackTimeout;
          slashableToClear.push({ jobId: lookupId, state: j.state, slashBps });
        } else {
          notYetClearable.push(lookupId);
        }
      }
      // Terminal states (TimedOut/Disputed/Resolved/Released) never block.
    }

    // Conservative estimate: sum per-job bps, capped at the protocol max-slash.
    const totalBps = Math.min(
      slashableToClear.reduce((s, j) => s + j.slashBps, 0),
      cfg.slashBps.max,
    );
    const estimatedSlashLcai = (Number(st.stakeWei) / 1e18) * (totalBps / 10_000);
    const blockedBy = [
      ...releasableNow,
      ...releasePending,
      ...slashableToClear.map((j) => j.jobId),
      ...notYetClearable,
    ];
    const ok = blockedBy.length === 0;
    const windowHrs = Math.round(cfg.disputeWindowSec / 3600);
    const reason = ok
      ? "No in-flight jobs detected; deregister should succeed."
      : [
          `${blockedBy.length} job(s) block deregister.`,
          releasableNow.length ? `${releasableNow.length} completed job(s) releasable NOW (no slash) - settle() them.` : "",
          releasePending.length ? `${releasePending.length} completed job(s) still in their ${windowHrs}h dispute window (no slash; release later).` : "",
          slashableToClear.length
            ? `${slashableToClear.length} stuck job(s) can ONLY clear via claimTimeout, realizing ~${estimatedSlashLcai.toFixed(0)} LCAI of slashing (no no-slash path on-chain - ask the protocol guardian to clear them if you must avoid it).`
            : "",
          notYetClearable.length ? `${notYetClearable.length} in-flight job(s) not yet past their deadline.` : "",
        ]
          .filter(Boolean)
          .join(" ");

    return { ok, blockedBy, reason, releasableNow, releasePending, slashableToClear, estimatedSlashLcai };
  }

  // ---- 4) Settlement + exit (Docker-free) --------------------------------

  /** Settle one completed job past its dispute window. Permissionless. */
  async releaseJob(jobId: bigint | number): Promise<`0x${string}`> {
    return this.send("releaseJob", this.jobReg, JOB_REGISTRY_OPERATOR_ABI_PARSED, "releaseJob", [BigInt(jobId)]);
  }

  /**
   * Settle every releasable completed job in `candidateJobIds`. Returns the
   * unified {@link BatchJobOpResult}: `done` are the jobs settled (with tx),
   * `skipped` are completed jobs still inside their dispute window (not yet
   * releasable). Uses per-job calls so one not-ready job can't revert the rest.
   * (Candidate IDs that aren't in the Completed state are not settleable and
   * don't appear in either list.)
   */
  async releaseAll(candidateJobIds: Array<bigint | number>): Promise<BatchJobOpResult> {
    const done: BatchJobOpResult["done"] = [];
    const skipped: BatchJobOpResult["skipped"] = [];
    for (const id of candidateJobIds) {
      const j = await this.getJob(id);
      if (j.state !== "Completed") continue;
      // releaseJob takes the SAME lookup id passed to getJob, not j.jobId.
      const lookupId = BigInt(id);
      try {
        const tx = await this.releaseJob(lookupId);
        done.push({ jobId: lookupId, tx });
      } catch (e) {
        if (isWorkerOpError(e) && e.decoded?.name === "DisputeWindowNotElapsed") {
          skipped.push({ jobId: lookupId, reason: "completed but still inside the dispute window; retry after it elapses" });
          continue;
        }
        throw e;
      }
    }
    return { done, skipped };
  }

  /** Pull the worker's earned balance from the JobRegistry into the wallet. */
  async withdraw(): Promise<`0x${string}`> {
    return this.send("withdraw", this.jobReg, JOB_REGISTRY_OPERATOR_ABI_PARSED, "withdraw", []);
  }

  /**
   * Register THIS wallet as a worker on-chain, staking native LCAI in the same
   * transaction (registerWorker is payable). `encryptionPubKey` is the worker's
   * encryption public key bytes - the key users encrypt prompts to; the daemon
   * prints it, and `getWorkerEncryptionKey` reads back what's stored. The stake
   * defaults to the LIVE AIConfig minimum (never a hardcoded "50,000"), so the
   * registration can't bounce off a stale floor; pass `opts.stakeWei` to stake
   * more headroom up front. Pre-flights via eth_call when the publicClient
   * supports it, so an ineligible registration reverts with a decoded reason
   * before any gas is spent. Registration alone serves nothing - follow up with
   * addModel() so the dispatcher can route jobs to this worker.
   */
  async register(encryptionPubKey: `0x${string}`, opts?: { stakeWei?: bigint }): Promise<`0x${string}`> {
    const stakeWei = opts?.stakeWei ?? (await this.config()).minStakeWei;
    await this.simulateIfAvailable(
      "register", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "registerWorker", [encryptionPubKey], stakeWei,
    );
    return this.send("register", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "registerWorker", [encryptionPubKey], stakeWei);
  }

  /** Deregister - releases stake to the wallet. Reverts (ActiveJobsExist) if any in-flight job remains. */
  async deregister(): Promise<`0x${string}`> {
    return this.send("deregister", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "deregisterWorker", []);
  }

  /**
   * Add a supported model to THIS (already-registered) worker on-chain. Accepts a
   * model tag (e.g. "gemma4:e2b") or a raw bytes32 modelId.
   *
   * This is the gas-correct version of the step the worker daemon's one-shot
   * register botches: the daemon sends addSupportedModel with an under-set gas
   * limit, so it OutOfGas-reverts (and its rollback deregister can too). viem
   * estimates the gas here, so it lands. Use it to finish a worker that staked but
   * failed to add its model. No-op (returns null) if already serving the model.
   */
  async addModel(modelTagOrId: string): Promise<`0x${string}` | null> {
    const id = modelTagOrId.startsWith("0x") && modelTagOrId.length === 66
      ? (modelTagOrId.toLowerCase() as `0x${string}`)
      : (await import("./inference.js")).modelId(modelTagOrId);
    const already = (await this.read(this.workerReg, WORKER_REGISTRY_ABI_PARSED, "isEligible", [this.addr, id])) as boolean;
    if (already) return null;
    return this.send("addModel", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "addSupportedModel", [id]);
  }

  /**
   * The flagship rescue, ordered so it can NEVER silently burn stake or fire a
   * doomed deregister:
   *   1. FREE: release every completed job past its dispute window + withdraw
   *      earnings. Always safe, no slash.
   *   2. GATE: if stuck in-flight jobs remain, they can only clear via
   *      claimTimeout (a slash). This step runs ONLY when `opts.acceptSlash` is
   *      true; otherwise it stops and returns the priced `blocked` readiness so
   *      the caller can decide (or route to the protocol guardian for a no-slash
   *      clear). Defaulting to false means the common call recovers earnings
   *      without ever slashing.
   *   3. DEREGISTER: only when nothing blocks. If completed jobs are still in
   *      their dispute window, it returns `blocked` (retry after they elapse)
   *      instead of reverting ActiveJobsExist.
   * Pass the worker's known job IDs (from the subgraph). `deregisterTx` is set
   * only when the worker actually deregistered.
   */
  async unstickAndDeregister(
    candidateJobIds: Array<bigint | number>,
    opts: { acceptSlash?: boolean } = {},
  ): Promise<{
    released: Array<{ jobId: bigint; tx: `0x${string}` }>;
    releaseSkipped: Array<{ jobId: bigint; reason: string }>;
    cleared: Array<{ jobId: bigint; tx: `0x${string}` }>;
    withdrawTx?: `0x${string}`;
    deregisterTx?: `0x${string}`;
    /** Present (and deregisterTx absent) when deregister could not complete. */
    blocked?: DeregisterReadiness;
  }> {
    // 1) FREE path - release ready completed jobs + claim earnings.
    const release = await this.releaseAll(candidateJobIds);
    let withdrawTx: `0x${string}` | undefined;
    if ((await this.status()).claimableWei > 0n) withdrawTx = await this.withdraw();

    const base = {
      released: release.done,
      releaseSkipped: release.skipped,
      withdrawTx,
    };

    // 2) Stop before any slashing unless explicitly authorized.
    const before = await this.canDeregister(candidateJobIds);
    if (before.slashableToClear.length > 0 && !opts.acceptSlash) {
      return { ...base, cleared: [], blocked: before };
    }

    // 3) Slashing teardown (opt-in only).
    let cleared: Array<{ jobId: bigint; tx: `0x${string}` }> = [];
    if (opts.acceptSlash && before.slashableToClear.length > 0) {
      cleared = (await this.clearStuck(candidateJobIds)).done;
    }

    // 4) Deregister only when nothing blocks - else surface a clear retry hint.
    const after = await this.canDeregister(candidateJobIds);
    if (!after.ok) return { ...base, cleared, blocked: after };
    const deregisterTx = await this.deregister();
    return { ...base, cleared, deregisterTx };
  }

  // ---- stake ops ----------------------------------------------------------

  async topUpStake(lcai: number): Promise<`0x${string}`> {
    return this.send("topUpStake", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "topUpStake", [], toWeiFromLcai(lcai));
  }

  async withdrawStake(lcai: number): Promise<`0x${string}`> {
    return this.send("withdrawStake", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "withdrawStake", [toWeiFromLcai(lcai)]);
  }

  async reinstate(): Promise<`0x${string}`> {
    return this.send("reinstate", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "reinstate", []);
  }

  // ---- 5) Real economics --------------------------------------------------

  /**
   * Earnings breakdown: claimable-now (on-chain workerBalance) plus lifetime +
   * pending-release counts derived from the worker record + its jobs. The caller
   * passes the subgraph-sourced worker record and jobs (e.g. from LightNode) so
   * this module stays free of a GraphQL dependency.
   */
  async earnings(input: {
    lifetimeEarnedWei?: bigint | string;
    jobsCompleted?: number;
    jobsTimedOut?: number;
    jobs?: Array<{ state: string }>;
  }): Promise<EarningsBreakdown> {
    const claimableWei = (await this.read(
      this.jobReg,
      JOB_REGISTRY_OPERATOR_ABI_PARSED,
      "workerBalance",
      [this.addr],
    )) as bigint;
    const pendingRelease = (input.jobs ?? []).filter((j) => /complet/i.test(j.state)).length;
    return {
      claimableLcai: toLcai(claimableWei),
      lifetimeLcai: input.lifetimeEarnedWei ? toLcai(BigInt(input.lifetimeEarnedWei)) : 0,
      pendingReleaseCount: pendingRelease,
      jobsCompleted: input.jobsCompleted ?? 0,
      jobsTimedOut: input.jobsTimedOut ?? 0,
    };
  }

  /**
   * Net profitability: per-job worker fee (from live AIConfig fee split + the
   * model fee) minus an estimated gas cost per job. Pure math over live config so
   * an operator can answer "is this worth running" without a spreadsheet.
   */
  async profitability(input: {
    modelTag?: string;
    modelFeeWei?: bigint;
    gasPerJobLcai?: number;
    jobsPerDay?: number;
  }): Promise<{
    workerFeeLcaiPerJob: number;
    gasLcaiPerJob: number;
    netLcaiPerJob: number;
    breakEvenJobsPerDay: number | null;
    projectedDailyLcai: number | null;
  }> {
    const cfg = await this.config();
    let feeWei = input.modelFeeWei ?? 0n;
    if (!feeWei && input.modelTag) {
      feeWei = (await this.read(
        this.network.aiConfig as `0x${string}`,
        AI_CONFIG_ABI_PARSED,
        "getModelFee",
        [(await import("./inference.js")).modelId(input.modelTag)],
      )) as bigint;
    }
    const workerFeeWei = (feeWei * BigInt(cfg.feeBps.worker)) / BPS;
    const workerFeeLcaiPerJob = toLcai(workerFeeWei);
    const gasLcaiPerJob = input.gasPerJobLcai ?? 0.001; // ack+complete+release ≈ tiny on LightChain
    const netLcaiPerJob = workerFeeLcaiPerJob - gasLcaiPerJob;
    const breakEvenJobsPerDay = netLcaiPerJob > 0 ? 0 : null;
    const projectedDailyLcai = input.jobsPerDay != null ? netLcaiPerJob * input.jobsPerDay : null;
    return { workerFeeLcaiPerJob, gasLcaiPerJob, netLcaiPerJob, breakEvenJobsPerDay, projectedDailyLcai };
  }
}
