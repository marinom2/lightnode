import { describe, it, expect } from "vitest";
import { inferGpu, assessMachine, estimateRewards, energyCostPerDay, workerSharePerJob, type MachineInput } from "@/lib/hardware";

describe("inferGpu", () => {
  it("infers VRAM for known NVIDIA GPUs", () => {
    expect(inferGpu("NVIDIA GeForce RTX 4090").vramGb).toBe(24);
    expect(inferGpu("NVIDIA A100-SXM4-80GB").vramGb).toBe(80);
    expect(inferGpu("NVIDIA GeForce RTX 4060").vramGb).toBe(8);
  });
  it("flags Apple Silicon as unified", () => {
    const g = inferGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)");
    expect(g.unified).toBe(true);
    expect(g.vramGb).toBeUndefined();
  });
  it("returns no VRAM for unknown GPUs", () => {
    const g = inferGpu("Some Random Intel iGPU");
    expect(g.vramGb).toBeUndefined();
    expect(g.unified).toBeFalsy();
  });
});

const base: MachineInput = { cores: 8, ramGb: 32, vramGb: 8, storageGb: 512, os: "linux" };

describe("assessMachine", () => {
  it("marks an 8GB GPU as worker-eligible", () => {
    const a = assessMachine(base);
    expect(a.vramOk).toBe(true);
    expect(a.workerEligible).toBe(true);
    expect(a.tier).toBe("eligible");
  });
  it("marks a 24GB GPU as premium", () => {
    expect(assessMachine({ ...base, vramGb: 24 }).tier).toBe("premium");
  });
  it("flags below-minimum GPU with CPU fallback", () => {
    const a = assessMachine({ ...base, vramGb: 0, ramGb: 16 });
    expect(a.vramOk).toBe(false);
    expect(a.cpuFallback).toBe(true);
    expect(a.tier).toBe("below");
  });
  it("produces a 0-100 score", () => {
    const a = assessMachine(base);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });

  it("treats Apple Silicon unified memory as eligible without a RAM-below warning", () => {
    // The browser caps deviceMemory at 8GB and the GPU shares that pool, so a
    // real 16GB+ M-series machine reports ramGb:8 / vramGb:16 (forced min).
    const a = assessMachine({ cores: 8, ramGb: 8, vramGb: 16, storageGb: 512, os: "macos", unified: true });
    expect(a.vramOk).toBe(true);
    expect(a.workerEligible).toBe(true);
    expect(a.notes.some((n) => /below the .*minimum/i.test(n))).toBe(false);
  });

  it("still flags low RAM on a discrete (non-unified) machine", () => {
    const a = assessMachine({ cores: 8, ramGb: 8, vramGb: 16, storageGb: 512, os: "linux" });
    expect(a.notes.some((n) => /below the 16GB minimum/i.test(n))).toBe(true);
  });
});

describe("estimateRewards", () => {
  it("derives daily/monthly from jobs/day at the 80% worker share", () => {
    const r = estimateRewards(100);
    expect(r.perJobLcai).toBeCloseTo(workerSharePerJob); // 0.016
    expect(r.dailyLcai).toBeCloseTo(100 * 0.016);
    expect(r.monthlyLcai).toBeCloseTo(100 * 0.016 * 30);
  });
});

describe("energyCostPerDay", () => {
  it("computes kWh cost over 24h", () => {
    // 200W at $0.15/kWh = 0.2 * 24 * 0.15 = $0.72/day
    expect(energyCostPerDay(200, 0.15)).toBeCloseTo(0.72);
  });
  it("is zero for non-positive inputs", () => {
    expect(energyCostPerDay(0, 0.15)).toBe(0);
    expect(energyCostPerDay(200, 0)).toBe(0);
  });
});
