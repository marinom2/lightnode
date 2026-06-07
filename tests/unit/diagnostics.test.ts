import { describe, it, expect } from "vitest";
import { buildDiagnosticsReport } from "@/lib/diagnostics";
import type { WorkerActionCenter } from "lightnode-sdk";
import type { Job } from "@/lib/subgraph";

const NOW = 1_780_600_000;

const ACTIONS: WorkerActionCenter = {
  address: "0xdf589ff8897C351d4E09E688b333C67fcB027802",
  registered: true,
  stakeLcai: 50_000,
  claimableLcai: 0.016,
  walletGasLcai: 0,
  outOfGas: true,
  settlement: { pendingReleaseCount: 7, releasableNowCount: 7, inWindowCount: 0, releasableJobIds: ["934"] },
  liveness: {
    address: "0xdf58",
    status: "active",
    liveness: "stalled",
    lastSeenAgoSec: 166_000,
    activeJobCount: 3,
    stuckJobs: [{ id: "981", kind: "unacked", state: "Submitted", deadlineAtSec: 0, pastDeadlineSec: 166_000, slashBps: 200 }],
    unackedCount: 1,
    incompleteCount: 0,
    slashExposureBps: 200,
    slashExposureLcai: 1000,
    suspensionThreshold: 3,
    suspensionRisk: false,
    summary: "1 assigned but never acknowledged (worker offline)",
  },
  actions: [
    { kind: "fund-gas", urgency: "critical", title: "Fund the worker wallet to pay gas", detail: "wallet is empty" },
    { kind: "settle", urgency: "info", title: "Settle 7 completed jobs", detail: "past dispute window" },
  ],
  summary: "Fund the worker wallet to pay gas (+1 more)",
};

const JOBS: Job[] = [
  { id: "934", state: "Completed", ack_at: NOW - 90_000, completed_at: NOW - 89_982 },
  { id: "841", state: "Released", ack_at: NOW - 100_000, completed_at: NOW - 99_988, worker_share: "16000000000000000" },
];

describe("buildDiagnosticsReport", () => {
  const report = buildDiagnosticsReport(ACTIONS, JOBS, NOW);

  it("renders a copy-pasteable plain-text block with the key signals", () => {
    expect(report).toContain("LightChain worker diagnostics");
    expect(report).toContain("0xdf589ff8897C351d4E09E688b333C67fcB027802");
    expect(report).toContain("OUT OF GAS"); // the headline failure
    expect(report).toContain("claimable:   0.016 LCAI");
    expect(report).toContain("7 releasable now");
    expect(report).toContain("stuck jobs:  1");
  });

  it("lists the prioritized actions in order", () => {
    expect(report).toContain("1. [critical] Fund the worker wallet to pay gas");
    expect(report).toContain("2. [info] Settle 7 completed jobs");
  });

  it("handles an empty action list", () => {
    const clean = buildDiagnosticsReport({ ...ACTIONS, actions: [], outOfGas: false }, JOBS, NOW);
    expect(clean).toContain("(none)");
    expect(clean).not.toContain("OUT OF GAS");
  });
});
