import { describe, it, expect } from "vitest";
import { aggregateWorkers, withdrawTarget } from "./worker";

describe("aggregateWorkers", () => {
  it("sums jobs and earnings, counts active workers", () => {
    const out = aggregateWorkers([
      { status: "active", jobs_completed: 100, total_earned: "2000000000000000000" },
      { status: "deactivated", jobs_completed: 50, total_earned: "1000000000000000000" },
      { status: "active", jobs_completed: 25, total_earned: "500000000000000000" },
    ]);
    expect(out).toEqual({ totalWorkers: 3, activeWorkers: 2, jobsCompleted: 175, totalEarnedLcai: 3.5 });
  });
  it("survives junk records from the indexer", () => {
    const out = aggregateWorkers([
      { status: "active", jobs_completed: Number.NaN, total_earned: "not-a-number" },
      null,
      { jobs_completed: 10, total_earned: "1000000000000000000" },
    ] as never);
    expect(out.totalWorkers).toBe(3);
    expect(out.jobsCompleted).toBe(10);
    expect(out.totalEarnedLcai).toBe(1);
  });
  it("handles a non-array response", () => {
    expect(aggregateWorkers(undefined)).toEqual({ totalWorkers: 0, activeWorkers: 0, jobsCompleted: 0, totalEarnedLcai: 0 });
  });
});

describe("withdrawTarget", () => {
  it("targets the JobRegistry with the withdraw() selector", () => {
    const t = withdrawTarget();
    expect(t.to).toBe("0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b");
    expect(t.data).toBe("0x3ccfd60b");
  });
});
