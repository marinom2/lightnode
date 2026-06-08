import { describe, it, expect } from "vitest";
import { createInMemoryRateLimiter } from "../../lib/demo-rate-limit";

describe("createInMemoryRateLimiter", () => {
  it("allows up to max per window, then blocks, with a correct remaining count", () => {
    let t = 0;
    const rl = createInMemoryRateLimiter({ windowMs: 1000, max: 3, now: () => t });
    expect(rl("a")).toEqual({ ok: true, remaining: 2 });
    expect(rl("a")).toEqual({ ok: true, remaining: 1 });
    expect(rl("a")).toEqual({ ok: true, remaining: 0 });
    expect(rl("a")).toEqual({ ok: false, remaining: 0 }); // 4th in-window -> blocked
  });

  it("resets an IP's window after windowMs elapses", () => {
    let t = 0;
    const rl = createInMemoryRateLimiter({ windowMs: 1000, max: 1, now: () => t });
    expect(rl("a").ok).toBe(true);
    expect(rl("a").ok).toBe(false);
    t = 1001; // past the window
    expect(rl("a").ok).toBe(true); // fresh window
  });

  it("isolates IPs", () => {
    let t = 0;
    const rl = createInMemoryRateLimiter({ windowMs: 1000, max: 1, now: () => t });
    expect(rl("a").ok).toBe(true);
    expect(rl("b").ok).toBe(true);
    expect(rl("a").ok).toBe(false);
  });

  it("prunes expired entries so the map does not grow unbounded", () => {
    let t = 0;
    const rl = createInMemoryRateLimiter({ windowMs: 1000, max: 1, now: () => t });
    rl("a");
    rl("b");
    expect(rl.entryCount()).toBe(2);
    // Jump past the window: the next call's prune sweeps the two stale entries.
    t = 5000;
    rl("c");
    expect(rl.entryCount()).toBe(1); // only "c" remains; a and b were pruned
  });

  it("force-sweeps when the entry cap is exceeded even within a window", () => {
    let t = 0;
    const rl = createInMemoryRateLimiter({ windowMs: 10_000, max: 1, maxEntries: 2, now: () => t });
    rl("a"); // t=0
    t = 11_000; // a is now expired but we haven't swept (lastSweep=0, 11000-0 >= windowMs anyway)
    rl("b"); // sweep triggers, a pruned
    rl("c");
    // a expired+pruned; b and c are within their own windows from t=11000
    expect(rl.entryCount()).toBe(2);
  });
});
