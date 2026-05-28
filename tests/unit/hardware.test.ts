import { describe, it, expect } from "vitest";
import { inferGpu, assessMachine, workerSharePerJob, modelRequirement, modelsMemoryGb, modelsFit, detectWebGpu, type MachineInput } from "@/lib/hardware";

describe("detectWebGpu", () => {
  it("resolves to an empty result when no WebGPU adapter is available", async () => {
    // No navigator.gpu in the test env - it must degrade gracefully, never throw.
    await expect(detectWebGpu()).resolves.toEqual({});
  });
});

describe("multi-model memory gate", () => {
  it("sums the resident footprint of a model set", () => {
    expect(modelsMemoryGb(["llama3-8b"])).toBe(8);
    expect(modelsMemoryGb(["llama3-8b", "llama3-70b"])).toBe(8 + 48);
  });
  it("fits only when the machine can hold the whole set warm", () => {
    expect(modelsFit(["llama3-8b"], 16)).toBe(true);
    expect(modelsFit(["llama3-8b", "llama3-70b"], 24)).toBe(false); // needs 56, has 24
    expect(modelsFit(["llama3-8b", "llama3-70b"], 64)).toBe(true);
    expect(modelsFit([], 64)).toBe(false); // nothing selected
    expect(modelsFit(["llama3-8b"], 0)).toBe(false); // unknown machine
  });
});

describe("modelRequirement", () => {
  it("reads the param count from the model name", () => {
    expect(modelRequirement("llama3-8b").paramsB).toBe(8);
    expect(modelRequirement("llama3-70b").paramsB).toBe(70);
    expect(modelRequirement("gemma4:e2b").paramsB).toBe(2); // version '4' ignored, '2b' params
  });
  it("tiers by size", () => {
    expect(modelRequirement("gemma4:e2b").tier).toBe("light");
    expect(modelRequirement("llama3-8b").tier).toBe("standard");
    expect(modelRequirement("llama3-70b").tier).toBe("server");
    expect(modelRequirement("llama3-70b").vramGb).toBe(48);
  });
  it("falls back to a standard assumption for unknown names", () => {
    expect(modelRequirement("mystery-model").tier).toBe("standard");
  });
});

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
    // Honest about unified memory: the model fits, but it's "eligible", not
    // "comfortably", and we flag that real speed depends on the chip.
    expect(a.tier).toBe("eligible");
    expect(a.tierLabel).toMatch(/fits/i);
    expect(a.notes.some((n) => /speed depends on your chip/i.test(n))).toBe(true);
  });

  it("still calls a DISCRETE 12GB+ GPU strong (real compute headroom)", () => {
    const a = assessMachine({ ...base, vramGb: 16 });
    expect(a.tier).toBe("strong");
  });

  it("still flags low RAM on a discrete (non-unified) machine", () => {
    const a = assessMachine({ cores: 8, ramGb: 8, vramGb: 16, storageGb: 512, os: "linux" });
    expect(a.notes.some((n) => /below the 16GB minimum/i.test(n))).toBe(true);
  });
});

describe("workerSharePerJob", () => {
  it("is 80% of the per-job fee", () => {
    expect(workerSharePerJob).toBeCloseTo(0.016);
  });
});
