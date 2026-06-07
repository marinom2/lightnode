/**
 * Worker "action center": a single read-only rollup of everything an operator
 * needs to decide what to do right now - claimable earnings, the worker wallet's
 * gas balance (the thing that silently blocks every settle/claim/deregister when
 * it is empty), which completed jobs are settleable now vs still in their dispute
 * window, the liveness / stuck-job picture, and a prioritized to-do list. Pure
 * analyzers (no I/O) so they are deterministic and testable; LightNode.
 * getWorkerActions wires them to live data.
 */
import type { Job, Worker } from "./types.js";
import type { WorkerProtocolConfig, WorkerStatus } from "./worker-operator.js";
import { analyzeWorkerLiveness, type WorkerLivenessReport } from "./liveness.js";

/** Below this wallet balance (wei) the worker effectively cannot pay for a tx, so
 *  settle/claim/deregister fail to send. LightChain gas is tiny, but 0 is 0. */
export const GAS_FLOOR_WEI = 10n ** 15n; // 0.001 LCAI

export interface SettlementSummary {
  /** Completed jobs not yet released (releasableNow + inWindow). */
  pendingReleaseCount: number;
  /** Completed jobs past the dispute window - settleable right now. */
  releasableNowCount: number;
  /** Completed jobs still inside the dispute window - settle later. */
  inWindowCount: number;
  /** Job ids that can be released right now (for a one-click settle). */
  releasableJobIds: string[];
}

export type ActionKind = "fund-gas" | "clear-stuck" | "settle" | "claim" | "wait-window";
export type ActionUrgency = "critical" | "warning" | "info";

export interface WorkerAction {
  kind: ActionKind;
  urgency: ActionUrgency;
  title: string;
  detail: string;
}

export interface WorkerActionCenter {
  address: string;
  registered: boolean;
  stakeLcai: number;
  /** Earnings released into the JobRegistry but not yet withdrawn to the wallet. */
  claimableLcai: number;
  /** The worker wallet's native balance - what every tx is paid from. */
  walletGasLcai: number;
  /** True when the wallet can't cover gas, so settle/claim/deregister will fail. */
  outOfGas: boolean;
  settlement: SettlementSummary;
  liveness: WorkerLivenessReport;
  /** Prioritized, deduplicated to-do list, most urgent first. */
  actions: WorkerAction[];
  summary: string;
}

/** Config subset the settlement analyzer needs. */
export type SettlementConfig = Pick<WorkerProtocolConfig, "disputeWindowSec">;

function isCompletedUnreleased(state: string): boolean {
  const s = state.toLowerCase();
  // Completed but not yet Released/Resolved/Paid (those are already settled).
  return s.includes("complet");
}

/** Classify a worker's Completed jobs into settle-now vs still-in-dispute-window. */
export function analyzeSettlement(jobs: Job[], config: SettlementConfig, nowSec?: number): SettlementSummary {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const pending = jobs.filter((j) => isCompletedUnreleased(j.state ?? ""));
  const releasable = pending.filter((j) => j.completed_at != null && now > j.completed_at + config.disputeWindowSec);
  return {
    pendingReleaseCount: pending.length,
    releasableNowCount: releasable.length,
    inWindowCount: pending.length - releasable.length,
    releasableJobIds: releasable.map((j) => j.id),
  };
}

function lcai3(wei: bigint): number {
  return Number(wei / 10n ** 15n) / 1000; // 3-dp, exact for whole-LCAI values
}

/** Build the prioritized to-do list. Gas comes first - nothing else can run
 *  without it - then stuck jobs, then settle/claim, then passive waits. */
function buildActions(input: {
  outOfGas: boolean;
  walletGasLcai: number;
  claimableLcai: number;
  settlement: SettlementSummary;
  liveness: WorkerLivenessReport;
  address: string;
}): WorkerAction[] {
  const { outOfGas, claimableLcai, settlement, liveness } = input;
  const hasWork = settlement.releasableNowCount > 0 || claimableLcai > 0 || liveness.stuckJobs.length > 0;
  const actions: WorkerAction[] = [];
  if (outOfGas && hasWork) {
    actions.push({
      kind: "fund-gas",
      urgency: "critical",
      title: "Fund the worker wallet to pay gas",
      detail: `The worker wallet holds ~${input.walletGasLcai} LCAI. Settle, claim, and deregister are all paid from it, so they cannot be sent until you send it a little LCAI.`,
    });
  }
  if (liveness.stuckJobs.length > 0) {
    actions.push({
      kind: "clear-stuck",
      urgency: "warning",
      title: `${liveness.stuckJobs.length} stuck job${liveness.stuckJobs.length > 1 ? "s" : ""} past the deadline`,
      detail: liveness.summary,
    });
  }
  if (settlement.releasableNowCount > 0) {
    actions.push({
      kind: "settle",
      urgency: "info",
      title: `Settle ${settlement.releasableNowCount} completed job${settlement.releasableNowCount > 1 ? "s" : ""}`,
      detail: "These are past their dispute window and can be released now to credit your earnings.",
    });
  }
  if (claimableLcai > 0) {
    actions.push({
      kind: "claim",
      urgency: "info",
      title: `Claim ${claimableLcai} LCAI of earnings`,
      detail: "Released earnings sit in the JobRegistry until you withdraw them to the worker wallet.",
    });
  }
  if (settlement.inWindowCount > 0) {
    actions.push({
      kind: "wait-window",
      urgency: "info",
      title: `${settlement.inWindowCount} job${settlement.inWindowCount > 1 ? "s" : ""} still in the dispute window`,
      detail: "Nothing to do yet - they become settleable once the dispute window passes.",
    });
  }
  return actions;
}

/** Compose the full action center from already-fetched, live data. Pure. */
export function analyzeWorkerActions(input: {
  worker: Worker | null;
  jobs: Job[];
  status: Pick<WorkerStatus, "registered" | "stakeLcai" | "claimableLcai">;
  walletGasWei: bigint;
  config: WorkerProtocolConfig;
  nowSec?: number;
}): WorkerActionCenter {
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const settlement = analyzeSettlement(input.jobs, input.config, nowSec);
  const liveness = analyzeWorkerLiveness({ worker: input.worker, jobs: input.jobs, config: input.config, nowSec });
  const walletGasLcai = lcai3(input.walletGasWei);
  const outOfGas = input.walletGasWei < GAS_FLOOR_WEI;
  const address = input.worker?.id ?? "";
  const actions = buildActions({
    outOfGas,
    walletGasLcai,
    claimableLcai: input.status.claimableLcai,
    settlement,
    liveness,
    address,
  });
  const summary =
    actions.length === 0
      ? "Nothing to do - no settleable jobs, no claimable earnings, no stuck jobs."
      : actions[0].title + (actions.length > 1 ? ` (+${actions.length - 1} more)` : "");
  return {
    address,
    registered: input.status.registered,
    stakeLcai: input.status.stakeLcai,
    claimableLcai: input.status.claimableLcai,
    walletGasLcai,
    outOfGas,
    settlement,
    liveness,
    actions,
    summary,
  };
}
