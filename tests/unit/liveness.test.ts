import { describe, it, expect } from "vitest";
import { analyzeWorkerLiveness, type LivenessConfig } from "../../sdk/src/index";
import type { Job, Worker } from "../../sdk/src/types";

// Live mainnet AIConfig values (read on-chain): ack 90s, completion 120s,
// ack-timeout slash 200 bps (2%), completion-timeout 500 bps, max 5000, and the
// worker is suspended at 3 timeouts.
const CFG: LivenessConfig = {
  ackTimeoutSec: 90,
  completionTimeoutSec: 120,
  slashBps: { ackTimeout: 200, completionTimeout: 500, dispute: 1000, max: 5000 },
  suspensionThreshold: 3,
};
const NOW = 1_780_500_000;
const STAKE_50K = (50_000n * 10n ** 18n).toString();

function worker(over: Partial<Worker> = {}): Worker {
  return { id: "0xWORKER", status: "active", stake: STAKE_50K, active_job_count: 0, jobs_completed: 8, jobs_timed_out: 0, last_seen_at: NOW - 100, ...over };
}
function job(id: string, state: string, over: Partial<Job> = {}): Job {
  return { id, state, ...over };
}

describe("analyzeWorkerLiveness", () => {
  it("flags the real-world case: 3 Submitted jobs past the ack deadline (offline worker)", () => {
    // Mirrors the mainnet worker 0xdf58...7802: registered + staked, but 3
    // assigned jobs were never acknowledged and are long past the 90s ack window.
    const jobs = [
      job("981", "Submitted", { submitted_at: NOW - 3600 }),
      job("965", "Submitted", { submitted_at: NOW - 7200 }),
      job("963", "Submitted", { submitted_at: NOW - 10_000 }),
      job("934", "Completed", { submitted_at: NOW - 90_000, ack_at: NOW - 90_000, completed_at: NOW - 89_990 }),
    ];
    const r = analyzeWorkerLiveness({ worker: worker({ active_job_count: 3 }), jobs, config: CFG, nowSec: NOW });
    expect(r.liveness).toBe("stalled");
    expect(r.unackedCount).toBe(3);
    expect(r.incompleteCount).toBe(0);
    expect(r.stuckJobs.map((s) => s.id).sort()).toEqual(["963", "965", "981"]);
    expect(r.stuckJobs.every((s) => s.kind === "unacked")).toBe(true);
    expect(r.slashExposureBps).toBe(600); // 3 x 200
    expect(r.slashExposureLcai).toBe(3000); // 600 bps of 50,000 LCAI
    expect(r.suspensionRisk).toBe(true); // 3 >= threshold of 3
    expect(r.activeJobCount).toBe(3);
    expect(r.summary).toMatch(/never acknowledged/);
  });

  it("does NOT flag a Submitted job still inside the ack window", () => {
    const jobs = [job("1000", "Submitted", { submitted_at: NOW - 30 })]; // 30s < 90s ack window
    const r = analyzeWorkerLiveness({ worker: worker(), jobs, config: CFG, nowSec: NOW });
    expect(r.stuckJobs).toHaveLength(0);
    expect(r.liveness).toBe("fresh");
    expect(r.slashExposureLcai).toBe(0);
    expect(r.suspensionRisk).toBe(false);
  });

  it("flags an Acknowledged job past the completion deadline as incomplete", () => {
    const jobs = [job("2000", "Acknowledged", { submitted_at: NOW - 1000, ack_at: NOW - 500 })]; // 500s > 120s
    const r = analyzeWorkerLiveness({ worker: worker(), jobs, config: CFG, nowSec: NOW });
    expect(r.incompleteCount).toBe(1);
    expect(r.unackedCount).toBe(0);
    expect(r.stuckJobs[0].kind).toBe("incomplete");
    expect(r.stuckJobs[0].slashBps).toBe(500); // completion-timeout bps
    expect(r.liveness).toBe("stalled");
  });

  it("treats a healthy worker (only completed/released/in-window jobs) as fresh", () => {
    const jobs = [
      job("3001", "Released", { completed_at: NOW - 50_000 }),
      job("3002", "Completed", { completed_at: NOW - 40_000 }),
      job("3003", "Acknowledged", { ack_at: NOW - 30 }), // still inside completion window
    ];
    const r = analyzeWorkerLiveness({ worker: worker(), jobs, config: CFG, nowSec: NOW });
    expect(r.liveness).toBe("fresh");
    expect(r.stuckJobs).toHaveLength(0);
    expect(r.summary).toMatch(/keeping up/);
  });

  it("caps slash exposure at the protocol max", () => {
    // 30 unacked jobs x 200 bps = 6000 bps, but maxSlashBps is 5000.
    const jobs = Array.from({ length: 30 }, (_, i) => job(`${i}`, "Submitted", { submitted_at: NOW - 1000 }));
    const r = analyzeWorkerLiveness({ worker: worker(), jobs, config: CFG, nowSec: NOW });
    expect(r.unackedCount).toBe(30);
    expect(r.slashExposureBps).toBe(5000); // capped, not 6000
    expect(r.slashExposureLcai).toBe(25_000); // 50% of 50,000
  });

  it("reports unknown liveness when the indexer has never seen the worker", () => {
    const r = analyzeWorkerLiveness({ worker: null, jobs: [], config: CFG, nowSec: NOW });
    expect(r.liveness).toBe("unknown");
    expect(r.status).toBeNull();
    expect(r.summary).toMatch(/not found/i);
  });
});
