import { describe, it, expect } from "vitest";
import { analyzeWorkerActions, analyzeSettlement } from "../../sdk/src/index";
import type { WorkerProtocolConfig } from "../../sdk/src/worker-operator";
import type { Job, Worker } from "../../sdk/src/types";

const NOW = 1_780_600_000;
const DAY = 86_400;
const CFG: WorkerProtocolConfig = {
  minStakeWei: 50_000n * 10n ** 18n,
  minStakeLcai: 50_000,
  completionTimeoutSec: 120,
  ackTimeoutSec: 90,
  resolutionTimeoutSec: 3600,
  disputeWindowSec: DAY,
  slashBps: { ackTimeout: 200, completionTimeout: 500, dispute: 1000, max: 5000 },
  feeBps: { protocol: 0, worker: 10000, feePool: 0 },
  suspensionThreshold: 3,
  suspensionCooldownSec: 3600,
};

function worker(over: Partial<Worker> = {}): Worker {
  return { id: "0xW", status: "active", stake: (50_000n * 10n ** 18n).toString(), last_seen_at: NOW - 100, ...over };
}
function job(id: string, state: string, over: Partial<Job> = {}): Job {
  return { id, state, ...over };
}

describe("analyzeSettlement (dispute-window classification)", () => {
  it("splits Completed jobs into settle-now vs still-in-window", () => {
    const jobs = [
      job("1", "Completed", { completed_at: NOW - 2 * DAY }), // past window -> releasable
      job("2", "Completed", { completed_at: NOW - 10 }), // fresh -> in window
      job("3", "Released", { completed_at: NOW - 3 * DAY }), // already settled -> ignored
      job("4", "Submitted", { submitted_at: NOW - 10 }), // not completed -> ignored
    ];
    const s = analyzeSettlement(jobs, CFG, NOW);
    expect(s.pendingReleaseCount).toBe(2);
    expect(s.releasableNowCount).toBe(1);
    expect(s.inWindowCount).toBe(1);
    expect(s.releasableJobIds).toEqual(["1"]);
  });
});

describe("analyzeWorkerActions (the action center)", () => {
  const status = { registered: true, stakeLcai: 50_000, claimableLcai: 0.016 };

  it("the real case: out of gas with claimable earnings + settleable + stuck jobs", () => {
    // Mirrors mainnet 0xdf58...7802: empty wallet, 0.016 claimable, completed jobs
    // past their window, and 3 unacked stuck jobs.
    const jobs = [
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => job(`9${n}`, "Completed", { completed_at: NOW - 7 * DAY })),
      ...[8, 9, 10].map((n) => job(`${n}`, "Submitted", { submitted_at: NOW - 3600 })),
    ];
    const a = analyzeWorkerActions({ worker: worker({ active_job_count: 3 }), jobs, status, walletGasWei: 39_900n, config: CFG, nowSec: NOW });
    expect(a.outOfGas).toBe(true);
    expect(a.walletGasLcai).toBe(0);
    expect(a.claimableLcai).toBe(0.016);
    expect(a.settlement.releasableNowCount).toBe(7);
    expect(a.liveness.unackedCount).toBe(3);
    // Gas is the critical first action - nothing else can run without it.
    expect(a.actions[0].kind).toBe("fund-gas");
    expect(a.actions[0].urgency).toBe("critical");
    // and the rest of the to-do list is present, in priority order.
    expect(a.actions.map((x) => x.kind)).toEqual(["fund-gas", "clear-stuck", "settle", "claim"]);
  });

  it("a funded, healthy worker with settleable jobs does NOT flag gas", () => {
    const jobs = [job("1", "Completed", { completed_at: NOW - 2 * DAY })];
    const a = analyzeWorkerActions({ worker: worker(), jobs, status: { registered: true, stakeLcai: 50_000, claimableLcai: 0 }, walletGasWei: 5n * 10n ** 17n, config: CFG, nowSec: NOW });
    expect(a.outOfGas).toBe(false);
    expect(a.actions.map((x) => x.kind)).toEqual(["settle"]);
  });

  it("does not nag about gas when there's nothing to do", () => {
    const a = analyzeWorkerActions({ worker: worker(), jobs: [], status: { registered: true, stakeLcai: 50_000, claimableLcai: 0 }, walletGasWei: 0n, config: CFG, nowSec: NOW });
    expect(a.outOfGas).toBe(true); // wallet IS empty
    expect(a.actions).toEqual([]); // but nothing is pending, so no fund-gas nag
    expect(a.summary).toMatch(/nothing to do/i);
  });

  it("only in-window jobs -> a passive wait action, no settle", () => {
    const jobs = [job("1", "Completed", { completed_at: NOW - 60 })];
    const a = analyzeWorkerActions({ worker: worker(), jobs, status: { registered: true, stakeLcai: 50_000, claimableLcai: 0 }, walletGasWei: 5n * 10n ** 17n, config: CFG, nowSec: NOW });
    expect(a.settlement.inWindowCount).toBe(1);
    expect(a.actions.map((x) => x.kind)).toEqual(["wait-window"]);
  });
});
