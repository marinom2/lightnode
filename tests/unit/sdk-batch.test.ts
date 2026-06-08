import { describe, it, expect, vi, beforeEach } from "vitest";

// runInferenceBatch calls runInferenceWithKey from "./inference.js" with no
// injection seam, so we replace the whole module. The mock is controllable
// per-prompt via the `behaviors` map keyed on the (already system-prefixed)
// prompt string, and it also records concurrency so we can assert the cap.
const state = {
  inFlight: 0,
  maxInFlight: 0,
  calls: [] as Array<{ prompt: string; model?: string }>,
  behaviors: new Map<string, () => Promise<unknown>>(),
  defaultDelayMs: 0,
};

function makeResult(answer: string) {
  return {
    answer,
    txs: { createSession: "0xc", submitJob: "0xs", jobCompleted: "0xj" },
    worker: "0x0000000000000000000000000000000000000000",
    sessionId: 1n,
    jobId: 2n,
    attempts: 1,
    stalled: [],
  };
}

vi.mock("../../sdk/src/inference.js", () => ({
  runInferenceWithKey: vi.fn(async (args: { prompt: string; model?: string }) => {
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    state.calls.push({ prompt: args.prompt, model: args.model });
    try {
      const behavior = state.behaviors.get(args.prompt);
      if (behavior) return await behavior();
      // Default: a tiny async hop so multiple slots are genuinely concurrent.
      await new Promise((r) => setTimeout(r, state.defaultDelayMs));
      return makeResult(`answer:${args.prompt}`);
    } finally {
      state.inFlight--;
    }
  }),
}));

// Imported AFTER the mock is registered. batch.ts re-exports StalledWorkerError's
// behavior via "./errors.js"; we import the real class to construct a fixture.
import { runInferenceBatch } from "../../sdk/src/batch";
import { StalledWorkerError } from "../../sdk/src/errors";

beforeEach(async () => {
  state.inFlight = 0;
  state.maxInFlight = 0;
  state.calls = [];
  state.behaviors = new Map();
  state.defaultDelayMs = 0;
  // The mocked runInferenceWithKey is a persistent spy; clear its call history
  // between tests so per-test `toHaveBeenCalled` assertions stay isolated.
  const { runInferenceWithKey } = await import("../../sdk/src/inference.js");
  (runInferenceWithKey as ReturnType<typeof vi.fn>).mockClear();
});

describe("runInferenceBatch result ordering", () => {
  it("returns a stable array indexed by submission order, not completion order", async () => {
    // Make slot 0 resolve LAST and slot 2 resolve FIRST, yet output order must
    // still match submission order.
    state.behaviors.set("a", () => new Promise((r) => setTimeout(() => r(makeResult("RA")), 30)));
    state.behaviors.set("b", () => new Promise((r) => setTimeout(() => r(makeResult("RB")), 10)));
    state.behaviors.set("c", () => Promise.resolve(makeResult("RC")));

    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts: ["a", "b", "c"],
      concurrency: 3,
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(out.map((r) => r.prompt)).toEqual(["a", "b", "c"]);
    expect(out[0].result?.answer).toBe("RA");
    expect(out[1].result?.answer).toBe("RB");
    expect(out[2].result?.answer).toBe("RC");
    out.forEach((r) => expect(r.error).toBeNull());
  });

  it("preserves a per-slot tag on each result", async () => {
    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts: [
        { prompt: "p0", tag: "first" },
        { prompt: "p1", tag: "second" },
      ],
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out[0].tag).toBe("first");
    expect(out[1].tag).toBe("second");
  });
});

describe("runInferenceBatch independent per-slot errors", () => {
  it("one prompt throwing does not cancel the others; failed slot carries the error", async () => {
    state.behaviors.set("boom", () => Promise.reject(new Error("model blew up")));
    state.behaviors.set("ok1", () => Promise.resolve(makeResult("one")));
    state.behaviors.set("ok2", () => Promise.resolve(makeResult("two")));

    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts: ["ok1", "boom", "ok2"],
      concurrency: 3,
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out[0].result?.answer).toBe("one");
    expect(out[0].error).toBeNull();

    expect(out[1].result).toBeNull();
    expect(out[1].error).toMatchObject({ name: "Error", message: "model blew up" });
    expect(out[1].error?.jobId).toBeUndefined();

    expect(out[2].result?.answer).toBe("two");
    expect(out[2].error).toBeNull();
  });

  it("attaches jobId (as a string) when the slot fails with a StalledWorkerError", async () => {
    state.behaviors.set("stall", () =>
      Promise.reject(
        new StalledWorkerError({
          jobId: 42n,
          worker: "0x0000000000000000000000000000000000000000",
          submitTx: "0xabc",
          feeLcai: 1,
        }),
      ),
    );

    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts: ["stall"],
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out[0].result).toBeNull();
    expect(out[0].error?.name).toBe("StalledWorkerError");
    expect(out[0].error?.jobId).toBe("42");
  });
});

describe("runInferenceBatch concurrency cap", () => {
  it("never runs more than `concurrency` inferences in flight at once", async () => {
    state.defaultDelayMs = 15; // hold each slot open long enough to overlap

    const prompts = Array.from({ length: 12 }, (_, i) => `slot-${i}`);
    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts,
      concurrency: 3,
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out).toHaveLength(12);
    expect(state.maxInFlight).toBeLessThanOrEqual(3);
    expect(state.maxInFlight).toBe(3); // and it actually saturated the pool
  });

  it("caps the worker pool at the number of prompts when fewer than concurrency", async () => {
    state.defaultDelayMs = 10;
    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts: ["only-one", "and-two"],
      concurrency: 8,
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out).toHaveLength(2);
    expect(state.maxInFlight).toBe(2);
  });
});

describe("runInferenceBatch onSlotComplete callback", () => {
  it("fires exactly once per slot, for both successes and failures", async () => {
    state.behaviors.set("good", () => Promise.resolve(makeResult("g")));
    state.behaviors.set("bad", () => Promise.reject(new Error("nope")));

    const seen: Array<{ index: number; ok: boolean }> = [];
    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts: ["good", "bad"],
      concurrency: 2,
      onSlotComplete: (r) => seen.push({ index: r.index, ok: r.error === null }),
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.index).sort((a, b) => a - b)).toEqual([0, 1]);
    const byIndex = new Map(seen.map((s) => [s.index, s.ok]));
    expect(byIndex.get(0)).toBe(true);
    expect(byIndex.get(1)).toBe(false);
    expect(out).toHaveLength(2);
  });
});

describe("runInferenceBatch abort handling", () => {
  it("marks every slot AbortError when the signal is already aborted and never calls inference", async () => {
    const { runInferenceWithKey } = await import("../../sdk/src/inference.js");
    const ac = new AbortController();
    ac.abort();

    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      prompts: ["x", "y", "z"],
      concurrency: 2,
      signal: ac.signal,
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out).toHaveLength(3);
    out.forEach((r, i) => {
      expect(r.index).toBe(i);
      expect(r.result).toBeNull();
      expect(r.error?.name).toBe("AbortError");
      expect(r.error?.message).toMatch(/batch aborted before this slot ran/);
    });
    // Pre-aborted: no slot should have reached the underlying inference call.
    expect(runInferenceWithKey).not.toHaveBeenCalled();
    expect(state.calls).toHaveLength(0);
  });

  it("aborts remaining queued slots once the signal fires mid-run", async () => {
    const ac = new AbortController();
    // The first slot to run trips the abort; queued slots that start after must
    // short-circuit to AbortError without invoking inference.
    state.behaviors.set("trigger", () => {
      ac.abort();
      return Promise.resolve(makeResult("first"));
    });

    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      // concurrency 1 makes the schedule deterministic: trigger runs, aborts,
      // then the remaining slots are pulled one-by-one and see aborted=true.
      prompts: ["trigger", "later-1", "later-2"],
      concurrency: 1,
      signal: ac.signal,
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out[0].error).toBeNull();
    expect(out[0].result?.answer).toBe("first");
    expect(out[1].error?.name).toBe("AbortError");
    expect(out[2].error?.name).toBe("AbortError");
    // Only the trigger prompt ever reached inference.
    expect(state.calls.map((c) => c.prompt)).toEqual(["trigger"]);
  });
});

describe("runInferenceBatch passthrough to inference", () => {
  it("prefixes a shared system prompt and forwards a per-slot model override", async () => {
    const out = await runInferenceBatch({
      network: "testnet",
      privateKey: "0x" + "1".repeat(64),
      model: "base-model",
      system: "  You are terse.  ",
      prompts: [
        { prompt: "hello" },
        { prompt: "hi", model: "override-model", system: "Be loud." },
      ],
      concurrency: 1,
    } as Parameters<typeof runInferenceBatch>[0]);

    expect(out).toHaveLength(2);
    // Shared system is trimmed and prepended with a blank line.
    expect(state.calls[0].prompt).toBe("You are terse.\n\nhello");
    expect(state.calls[0].model).toBe("base-model");
    // Per-slot system overrides the shared one; per-slot model overrides base.
    expect(state.calls[1].prompt).toBe("Be loud.\n\nhi");
    expect(state.calls[1].model).toBe("override-model");
  });
});
