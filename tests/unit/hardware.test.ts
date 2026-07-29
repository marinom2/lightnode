import { describe, it, expect } from "vitest";
import {
  inferGpu,
  assessMachine,
  workerSharePerJob,
  modelRequirement,
  modelsMemoryGb,
  modelsFit,
  modelFitsAlone,
  largestModelGb,
  usableVramGb,
  detectWebGpu,
  OS_VRAM_OVERHEAD_GB,
  UNKNOWN_MODEL_VRAM_GB,
  type MachineInput,
} from "@/lib/hardware";
import { MODEL_CATALOG, modelIdForTag } from "@/lib/model-catalog";

// A well-formed 32-byte digest that is NOT in the catalog. It ends in "0d9b" on
// purpose: the old name-regex parsed that as a 9B model and asserted 8GB
// "Standard" for a raw hash. Nothing may read a param count out of an id.
const UNKNOWN_ID = `0x${"0123456789abcdef".repeat(3)}deadbeefcafe0d9b`;

describe("detectWebGpu", () => {
  it("resolves to an empty result when no WebGPU adapter is available", async () => {
    // No navigator.gpu in the test env - it must degrade gracefully, never throw.
    await expect(detectWebGpu()).resolves.toEqual({});
  });
});

describe("multi-model memory gate", () => {
  it("sums the measured resident footprint of a model set", () => {
    // Catalog numbers, not the old name-guess: llama3-8b is a 4.7GB download
    // (~6.1GB resident), llama3-70b 40GB (~46.7GB) - not 8 and 48.
    expect(modelsMemoryGb(["llama3-8b"])).toBe(6.1);
    expect(modelsMemoryGb(["llama3-8b", "llama3-70b"])).toBe(52.8);
  });
  it("fits only when the machine can hold the whole set warm", () => {
    expect(modelsFit(["llama3-8b"], 16)).toBe(true);
    expect(modelsFit(["llama3-8b", "llama3-70b"], 24)).toBe(false); // needs 52.8, has 24
    expect(modelsFit(["llama3-8b", "llama3-70b"], 64)).toBe(true);
    expect(modelsFit([], 64)).toBe(false); // nothing selected
    expect(modelsFit(["llama3-8b"], 0)).toBe(false); // unknown machine
  });
  it("never calls a set with an unsized model a fit on a normal machine", () => {
    // An id we can't invert is treated as the largest model we know of, so a
    // 16GB card is honestly told "no" instead of a confident, wrong "yes".
    expect(modelsFit([UNKNOWN_ID], 16)).toBe(false);
    expect(modelsFit(["llama3-8b", UNKNOWN_ID], 24)).toBe(false);
  });
});

describe("modelRequirement", () => {
  it("takes measured catalog sizes over anything the name implies", () => {
    // gemma4:e2b reads as 2B (4GB "Light" under the old regex-only path) but is
    // an MoE with a 7.2GB download - it needs ~9GB resident, a whole GPU class up.
    const gemma = modelRequirement("gemma4:e2b");
    expect(gemma.paramsB).toBe(2); // version '4' ignored, '2b' params - no left-hand boundary
    expect(gemma.vramGb).toBe(9);
    expect(gemma.tier).toBe("standard");
    expect(gemma.known).toBe(true);
    expect(gemma.source).toBe("catalog");
    // 120B: the param table would have said 48GB; the measured peak is 59.9GB.
    const big = modelRequirement("gpt-oss:120b");
    expect(big.paramsB).toBe(120);
    expect(big.vramGb).toBe(59.9);
    expect(big.vramGb).toBeGreaterThan(48);
    expect(big.tier).toBe("server");
    expect(big.known).toBe(true);
  });
  it("sizes the models whose tags carry no number at all", () => {
    // "qwen3-coder-next" and "glm-4.7-flash" parse to 0 params - only the catalog
    // can size them, and one of them is the biggest model on the network.
    expect(modelRequirement("qwen3-coder-next").paramsB).toBe(0);
    expect(modelRequirement("qwen3-coder-next").vramGb).toBe(60.2);
    expect(modelRequirement("glm-4.7-flash").vramGb).toBe(17.8);
    expect(modelRequirement("qwen3-coder-next").known).toBe(true);
  });
  it("recovers a model handed to us as a bare on-chain id", () => {
    // 7 of 10 testnet models come back from the indexer with name === id.
    const req = modelRequirement(modelIdForTag("gpt-oss:120b"));
    expect(req.known).toBe(true);
    expect(req.entry?.tag).toBe("gpt-oss:120b");
    expect(req.vramGb).toBe(59.9);
  });
  it("tiers by measured size", () => {
    expect(modelRequirement("qwen3-embedding:0.6b").tier).toBe("light");
    expect(modelRequirement("llama3-8b").tier).toBe("standard");
    expect(modelRequirement("llama3-8b").vramGb).toBe(6.1);
    expect(modelRequirement("llama3-70b").tier).toBe("server");
    expect(modelRequirement("llama3-70b").vramGb).toBe(46.7);
    expect(modelRequirement("llama3-70b").paramsB).toBe(70);
  });
  it("marks an unrecoverable id unknown instead of asserting 8GB", () => {
    const req = modelRequirement(UNKNOWN_ID);
    expect(req.known).toBe(false);
    expect(req.source).toBe("unknown");
    expect(req.paramsB).toBe(0); // the trailing "9b" of the digest is NOT a param count
    expect(req.vramGb).not.toBe(8);
    expect(req.tierLabel).not.toMatch(/^Standard/);
    expect(req.tierLabel).toMatch(/unknown/i);
    expect(req.entry).toBeUndefined();
  });
  it("assumes an unsized model is as big as the biggest one we know", () => {
    // The only assumption that can't quietly overcommit a machine.
    const biggestKnown = largestModelGb(MODEL_CATALOG.map((e) => e.tag));
    expect(UNKNOWN_MODEL_VRAM_GB).toBeGreaterThanOrEqual(biggestKnown);
    expect(modelRequirement(UNKNOWN_ID).vramGb).toBe(UNKNOWN_MODEL_VRAM_GB);
  });
  it("still estimates from the name for a model we've never measured, and says so", () => {
    const req = modelRequirement("mistral-7b");
    expect(req.paramsB).toBe(7);
    expect(req.vramGb).toBe(8);
    expect(req.known).toBe(false); // an estimate is not a measurement
    expect(req.source).toBe("name");
    expect(req.tierLabel).toMatch(/estimated from the name/i);
  });
  it("parses param counts the old right-hand boundary missed, without a left-hand one", () => {
    // '_' is a word char, so the old /b\b/ never matched a quant suffix.
    expect(modelRequirement("llama3-8B_K_M").paramsB).toBe(8);
    // The digit here is preceded by a letter ('e4b') - a left-hand boundary
    // would drop it to 0 and silently size the model as unknown.
    expect(modelRequirement("gemma4:e4b").paramsB).toBe(4);
    expect(modelRequirement("gemma4:e4b").source).toBe("name");
  });
});

describe("swap mode vs all-resident", () => {
  it("answers 'fits on its own' independently of the all-resident sum", () => {
    // The set can't be held warm together, yet each half fits alone - the state
    // a caller needs to offer swapping (only safe if cold-load beats the deadline).
    expect(modelsFit(["llama3-8b", "gpt-oss:20b"], 16)).toBe(false); // 6.1 + 11.9 = 18
    expect(modelFitsAlone("llama3-8b", 16)).toBe(true);
    expect(modelFitsAlone("gpt-oss:20b", 16)).toBe(true);
  });
  it("refuses a model bigger than the machine, or an unknown machine", () => {
    expect(modelFitsAlone("gpt-oss:120b", 16)).toBe(false);
    expect(modelFitsAlone("gpt-oss:120b", 80)).toBe(true);
    expect(modelFitsAlone("llama3-8b", 0)).toBe(false); // unknown machine
    expect(modelFitsAlone(UNKNOWN_ID, 16)).toBe(false); // unsized -> never a green fit
  });
  it("reports the heaviest model in a set", () => {
    expect(largestModelGb(["llama3-8b", "llama3-70b"])).toBe(46.7);
    expect(largestModelGb([])).toBe(0);
  });
});

describe("usableVramGb", () => {
  it("subtracts the desktop's own VRAM claim", () => {
    expect(OS_VRAM_OVERHEAD_GB).toBeGreaterThan(0);
    expect(usableVramGb(16)).toBe(14.5); // 4K X11 desktop already holds ~1.5GB
    expect(usableVramGb(16, 0)).toBe(16); // headless server pays nothing
  });
  it("never goes negative and keeps 0 meaning 'unknown machine'", () => {
    expect(usableVramGb(0)).toBe(0);
    expect(usableVramGb(1)).toBe(0);
    expect(usableVramGb(-4)).toBe(0);
  });
  it("is opt-in - the fit helpers take availGb at face value", () => {
    // 6.1 + 9 = 15.1: fits the sticker number, does NOT fit once the desktop is
    // paid for. Callers choose which question they're asking.
    expect(modelsFit(["llama3-8b", "gemma4:e2b"], 16)).toBe(true);
    expect(modelsFit(["llama3-8b", "gemma4:e2b"], usableVramGb(16))).toBe(false);
  });
});

describe("inferGpu", () => {
  it("infers VRAM for known NVIDIA GPUs", () => {
    expect(inferGpu("NVIDIA GeForce RTX 4090").vramGb).toBe(24);
    expect(inferGpu("NVIDIA A100-SXM4-80GB").vramGb).toBe(80);
    expect(inferGpu("NVIDIA GeForce RTX 4060").vramGb).toBe(8);
  });
  it("flags Apple Silicon as unified and cleans the chip name", () => {
    // The real renderer string a MacBook Air M3 reports in the browser.
    const g = inferGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)");
    expect(g.unified).toBe(true);
    expect(g.vramGb).toBeUndefined();
    expect(g.clean).toBe("Apple M3"); // cleaned from the verbose ANGLE string
    // the Pro/Max/Ultra tier suffix is preserved when present
    expect(inferGpu("Apple M2 Max").clean).toBe("Apple M2 Max");
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
